import { handleWebhook } from "@/lib/mercadopago/webhook";
import { webhookDeps } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await handleWebhook(
    { url: request.url, headers: request.headers, body: await request.text() },
    webhookDeps(),
  );
  return Response.json({ outcome: result.outcome }, { status: result.status });
}
