// Manda a tu endpoint local un webhook firmado igual que Mercado Pago.
// Uso: MP_WEBHOOK_SECRET=... node scripts/send-test-webhook.mjs <paymentId> [url]
import { createHmac, randomUUID } from "node:crypto";

const [paymentId, url = "http://localhost:3000/api/webhooks/mercadopago"] = process.argv.slice(2);
const secret = process.env.MP_WEBHOOK_SECRET;
if (!paymentId || !secret) {
  console.error("Uso: MP_WEBHOOK_SECRET=... node scripts/send-test-webhook.mjs <paymentId> [url]");
  process.exit(1);
}

const ts = String(Math.floor(Date.now() / 1000));
const requestId = randomUUID();
const manifest = `id:${paymentId.toLowerCase()};request-id:${requestId};ts:${ts};`;
const v1 = createHmac("sha256", secret).update(manifest).digest("hex");

const res = await fetch(`${url}?data.id=${encodeURIComponent(paymentId)}&type=payment`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
  body: JSON.stringify({ type: "payment", action: "payment.updated", data: { id: paymentId } }),
});
console.log(res.status, await res.text());
