import { after } from "next/server";
import { createClient, type MercadoPagoClient } from "@/lib/mercadopago/client";
import type { Logger, WebhookDeps, WebhookHooks } from "@/lib/mercadopago/webhook";
import { createMemoryStore, type OrderStore } from "@/lib/orders";

// Punto único de configuración: acá se cambia el store en memoria por tu base de datos
// y se conectan los efectos (dar acceso, mandar el recibo, etc.).

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const logger: Logger = {
  info: (msg, data) => console.log(JSON.stringify({ level: "info", msg, ...data })),
  warn: (msg, data) => console.warn(JSON.stringify({ level: "warn", msg, ...data })),
  error: (msg, data) => console.error(JSON.stringify({ level: "error", msg, ...data })),
};

const globalForStore = globalThis as unknown as { pagokitStore?: OrderStore };
export function orderStore(): OrderStore {
  return (globalForStore.pagokitStore ??= createMemoryStore());
}

let client: MercadoPagoClient | undefined;
export function mercadoPago(): MercadoPagoClient {
  return (client ??= createClient({ accessToken: requireEnv("MP_ACCESS_TOKEN") }));
}

const hooks: WebhookHooks = {
  async onStatusChange(order, from) {
    if (order.status === "paid") {
      // TODO: dar acceso, mandar el recibo, avisar al equipo...
      logger.info("order paid", { orderId: order.id, from });
    }
  },
};

export function webhookDeps(): WebhookDeps {
  return {
    secret: requireEnv("MP_WEBHOOK_SECRET"),
    client: mercadoPago(),
    store: orderStore(),
    hooks,
    logger,
    requireLiveMode: process.env.MP_REQUIRE_LIVE_MODE === "true",
    // Los efectos corren después de responder a Mercado Pago.
    defer: after,
  };
}
