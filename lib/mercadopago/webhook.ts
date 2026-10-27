import { canTransition, mapPaymentStatus, type Order, type OrderStatus, type OrderStore } from "../orders";
import { MercadoPagoError, type MercadoPagoClient } from "./client";
import { notificationSchema, type Payment } from "./schemas";
import { verifySignature } from "./signature";

export interface WebhookRequest {
  url: string;
  headers: Headers;
  body: string;
}

export interface WebhookHooks {
  // Se llama una sola vez por cambio de estado real, no por notificación recibida.
  onStatusChange?(order: Order, from: OrderStatus, payment: Payment): Promise<void> | void;
}

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface WebhookDeps {
  secret: string;
  client: Pick<MercadoPagoClient, "getPayment">;
  store: OrderStore;
  hooks?: WebhookHooks;
  logger?: Logger;
  // En producción conviene rechazar pagos de prueba (live_mode=false).
  requireLiveMode?: boolean;
  // Handlers para otros topics (p. ej. suscripciones). Reciben el data.id ya verificado por firma.
  topics?: Record<string, TopicHandler>;
}

export type TopicHandler = (dataId: string, log: Logger) => Promise<WebhookResult>;

export type WebhookOutcome =
  | "invalid_signature"
  | "resource_not_found"
  | "ignored_type"
  | "missing_data_id"
  | "payment_not_found"
  | "order_not_found"
  | "test_payment_rejected"
  | "unknown_status"
  | "amount_mismatch"
  | "no_change"
  | "updated"
  | "retry_later";

export interface WebhookResult {
  // 2xx le dice a Mercado Pago que no reintente; 5xx hace que reintente más tarde.
  status: number;
  outcome: WebhookOutcome | (string & {});
  orderId?: string;
  orderStatus?: OrderStatus;
}

const silentLogger: Logger = { info() {}, warn() {}, error() {} };

function sameAmount(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

export async function handleWebhook(req: WebhookRequest, deps: WebhookDeps): Promise<WebhookResult> {
  const log = deps.logger ?? silentLogger;
  const query = new URL(req.url).searchParams;

  let raw: unknown = {};
  try {
    raw = req.body ? JSON.parse(req.body) : {};
  } catch {
    raw = {};
  }
  const parsed = notificationSchema.safeParse(raw);
  const notification = parsed.success ? parsed.data : {};

  // Mercado Pago firma el data.id que manda en la query string.
  const dataId = query.get("data.id") ?? notification.data?.id ?? null;
  const type = query.get("type") ?? notification.type ?? null;

  const signature = verifySignature({
    xSignature: req.headers.get("x-signature"),
    xRequestId: req.headers.get("x-request-id"),
    dataId,
    secret: deps.secret,
  });
  if (!signature.ok) {
    log.warn("webhook rejected: invalid signature", { reason: signature.reason, dataId });
    return { status: 401, outcome: "invalid_signature" };
  }

  if (!dataId) return { status: 200, outcome: "missing_data_id" };
  if (type !== "payment") {
    const handler = type ? deps.topics?.[type] : undefined;
    if (!handler) return { status: 200, outcome: "ignored_type" };
    try {
      return await handler(dataId, log);
    } catch (err) {
      return lookupFailure(err, log, { type, dataId });
    }
  }

  // Nunca se confía en el cuerpo del webhook: el estado se lee de la API.
  let payment: Payment;
  try {
    payment = await deps.client.getPayment(dataId);
  } catch (err) {
    const result = lookupFailure(err, log, { type, dataId });
    return result.outcome === "resource_not_found" ? { ...result, outcome: "payment_not_found" } : result;
  }
  return processPayment(payment, deps);
}

// Traduce un error al leer un recurso de la API en la respuesta para Mercado Pago.
export function lookupFailure(err: unknown, log: Logger, context: Record<string, unknown>): WebhookResult {
  // 404 (o un id inválido): típico de la "notificación de prueba" del panel, que usa un id
  // inventado. Se confirma para que no se reintente.
  const notFound = err instanceof MercadoPagoError && (err.status === 404 || (err.status === null && !err.retryable));
  if (notFound) {
    log.warn("resource not found, not retrying", context);
    return { status: 200, outcome: "resource_not_found" };
  }
  // Cualquier otro error (API caída, 401/403 por un access token mal configurado) se devuelve
  // como 500: Mercado Pago reintenta y la notificación no se pierde.
  const status = err instanceof MercadoPagoError ? err.status : null;
  log.error("resource lookup failed, asking Mercado Pago to retry", { ...context, status, error: (err as Error).message });
  return { status: 500, outcome: "retry_later" };
}

// Aplica un pago (ya leído de la API) a su orden. Lo usan el webhook y la conciliación.
export async function processPayment(
  payment: Payment,
  deps: Pick<WebhookDeps, "store" | "hooks" | "logger" | "requireLiveMode">,
): Promise<WebhookResult> {
  const log = deps.logger ?? silentLogger;
  if (deps.requireLiveMode && payment.live_mode === false) {
    log.warn("test payment received in live mode", { paymentId: payment.id });
    return { status: 200, outcome: "test_payment_rejected" };
  }

  const orderId = payment.external_reference;
  const order = orderId ? await deps.store.get(orderId) : null;
  if (!order) {
    log.warn("payment without a matching order", {
      paymentId: payment.id,
      externalReference: orderId,
      status: payment.status,
      statusDetail: payment.status_detail,
    });
    return { status: 200, outcome: "order_not_found" };
  }

  let target = mapPaymentStatus(payment.status);
  if (!target) {
    log.warn("unknown payment status", { paymentId: payment.id, status: payment.status });
    return { status: 200, outcome: "unknown_status", orderId: order.id, orderStatus: order.status };
  }

  // Se valida que el monto y la moneda cobrados sean los de la orden antes de darla por pagada:
  // atrapa precios tomados del navegador, preferencias viejas tras un cambio de precio o un
  // link de pago reutilizado para otra orden.
  const mismatch =
    target === "paid" && (!sameAmount(payment.transaction_amount, order.amount) || payment.currency_id !== order.currency);
  if (mismatch) {
    log.error("amount mismatch", {
      orderId: order.id,
      paymentId: payment.id,
      expected: `${order.amount} ${order.currency}`,
      received: `${payment.transaction_amount} ${payment.currency_id}`,
    });
    target = "needs_review";
  }

  // Una orden pagada solo cambia por eventos del mismo pago (reembolso, contracargo):
  // otro pago rechazado con la misma referencia no la toca.
  const otherPayment = order.paymentId !== undefined && order.paymentId !== payment.id;
  if (!canTransition(order.status, target) || (otherPayment && order.status !== "pending" && order.status !== "failed")) {
    return {
      status: 200,
      outcome: mismatch ? "amount_mismatch" : "no_change",
      orderId: order.id,
      orderStatus: order.status,
    };
  }

  const changed = await deps.store.transition(order.id, order.status, target, { paymentId: payment.id });
  if (!changed) {
    // Otro webhook concurrente ganó la carrera; ese es el que dispara los efectos.
    return { status: 200, outcome: "no_change", orderId: order.id };
  }

  const updated = (await deps.store.get(order.id)) ?? { ...order, status: target, paymentId: payment.id };
  log.info("order updated", { orderId: order.id, from: order.status, to: target, paymentId: payment.id });
  try {
    await deps.hooks?.onStatusChange?.(updated, order.status, payment);
  } catch (err) {
    // El estado ya cambió: reintentar el webhook no volvería a disparar el hook.
    log.error("onStatusChange hook failed", { orderId: order.id, error: (err as Error).message });
  }
  return { status: 200, outcome: mismatch ? "amount_mismatch" : "updated", orderId: order.id, orderStatus: target };
}
