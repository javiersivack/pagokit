import type { z } from "zod";
import {
  createPreferenceSchema,
  paymentSchema,
  preferenceSchema,
  type CreatePreferenceInput,
  type Payment,
  type Preference,
} from "./schemas";

export class MercadoPagoError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "MercadoPagoError";
  }
}

export interface ClientOptions {
  accessToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  // Mercado Pago espera la respuesta del webhook en 22 s: 5 s por intento y 2 reintentos entran holgados.
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface MercadoPagoClient {
  getPayment(id: string): Promise<Payment>;
  createPreference(input: CreatePreferenceInput, idempotencyKey: string): Promise<Preference>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export type HttpMethod = "GET" | "POST" | "PUT";

export interface Http {
  request<T>(
    method: HttpMethod,
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T>;
}

// Capa HTTP compartida: timeouts, reintentos con backoff, idempotencia y respuestas validadas.
export function createHttp(options: ClientOptions): Http {
  const {
    accessToken,
    baseUrl = "https://api.mercadopago.com",
    fetchImpl = fetch,
    timeoutMs = 5000,
    maxRetries = 2,
    sleep = defaultSleep,
  } = options;
  if (!accessToken) throw new Error("Mercado Pago access token is required");

  async function request<T>(
    method: HttpMethod,
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    // Un POST solo se reintenta con idempotency key: si no, un timeout podría duplicar el cobro.
    // GET y PUT (que fija un estado) son idempotentes.
    const canRetry = method !== "POST" || Boolean(idempotencyKey);
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

    let lastError: MercadoPagoError | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100));
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastError = new MercadoPagoError(`${method} ${path} failed: ${(err as Error).message}`, null, true);
        if (canRetry) continue;
        throw lastError;
      }

      const text = await res.text();
      let json: unknown = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = text;
      }

      if (!res.ok) {
        lastError = new MercadoPagoError(
          `${method} ${path} returned ${res.status}`,
          res.status,
          isRetryableStatus(res.status),
          json,
        );
        if (lastError.retryable && canRetry) continue;
        throw lastError;
      }

      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new MercadoPagoError(`${method} ${path}: unexpected response shape`, res.status, false, json);
      }
      return parsed.data;
    }
    throw lastError ?? new MercadoPagoError(`${method} ${path} failed`, null, true);
  }

  return { request };
}

export function assertNumericId(kind: string, id: string): void {
  if (!/^\d+$/.test(id)) throw new MercadoPagoError(`invalid ${kind} id: ${id}`, null, false);
}

export function createClient(options: ClientOptions): MercadoPagoClient {
  const { request } = createHttp(options);
  return {
    async getPayment(id) {
      assertNumericId("payment", id);
      return request("GET", `/v1/payments/${id}`, paymentSchema);
    },
    async createPreference(input, idempotencyKey) {
      const body = createPreferenceSchema.parse(input);
      return request("POST", "/checkout/preferences", preferenceSchema, body, idempotencyKey);
    },
  };
}
