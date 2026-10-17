import { orderStore } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// El estado que ve el comprador sale del servidor (actualizado por el webhook),
// nunca de los parámetros con los que Mercado Pago lo devuelve a la página.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await orderStore().get(id);
  if (!order) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ id: order.id, status: order.status, amount: order.amount, currency: order.currency });
}
