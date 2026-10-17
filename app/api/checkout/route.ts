import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CATALOG } from "@/lib/catalog";
import { MercadoPagoError } from "@/lib/mercadopago/client";
import { logger, mercadoPago, orderStore, requireEnv } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ productId: z.string() });

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const product = parsed.success ? CATALOG[parsed.data.productId] : undefined;
  if (!product) return Response.json({ error: "unknown_product" }, { status: 400 });

  const now = new Date().toISOString();
  const orderId = randomUUID();
  await orderStore().create({
    id: orderId,
    productId: product.id,
    amount: product.price,
    currency: product.currency,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  const appUrl = requireEnv("APP_URL").replace(/\/$/, "");
  const back = `${appUrl}/?order=${orderId}`;
  try {
    const preference = await mercadoPago().createPreference(
      {
        items: [{ id: product.id, title: product.title, quantity: 1, unit_price: product.price, currency_id: product.currency }],
        external_reference: orderId,
        back_urls: { success: back, failure: back, pending: back },
        // Mercado Pago solo acepta auto_return con back_urls https.
        ...(appUrl.startsWith("https://") ? { auto_return: "approved" as const } : {}),
      },
      `preference-${orderId}`,
    );
    return Response.json({ orderId, checkoutUrl: preference.init_point });
  } catch (err) {
    logger.error("create preference failed", {
      orderId,
      error: (err as Error).message,
      status: err instanceof MercadoPagoError ? err.status : undefined,
    });
    return Response.json({ error: "checkout_unavailable" }, { status: 502 });
  }
}
