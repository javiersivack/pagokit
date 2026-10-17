import { buildManifest, sign } from "@/lib/mercadopago/signature";
import type { Payment } from "@/lib/mercadopago/schemas";
import { createMemoryStore, type Order } from "@/lib/orders";

export const SECRET = "test-secret";

export function signedRequest(dataId: string, opts: { type?: string; secret?: string; requestId?: string } = {}) {
  const ts = "1704908010";
  const requestId = opts.requestId ?? "req-1";
  const v1 = sign(opts.secret ?? SECRET, buildManifest(dataId, requestId, ts));
  return {
    url: `https://shop.test/api/webhooks/mercadopago?data.id=${dataId}&type=${opts.type ?? "payment"}`,
    headers: new Headers({ "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId }),
    body: JSON.stringify({ type: opts.type ?? "payment", action: "payment.updated", data: { id: dataId } }),
  };
}

export function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    productId: "plan-pro",
    amount: 1500,
    currency: "ARS",
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "111",
    status: "approved",
    external_reference: "order-1",
    transaction_amount: 1500,
    currency_id: "ARS",
    live_mode: true,
    ...overrides,
  };
}

export async function storeWith(...orders: Order[]) {
  const store = createMemoryStore();
  for (const o of orders) await store.create(o);
  return store;
}
