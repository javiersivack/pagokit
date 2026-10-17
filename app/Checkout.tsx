"use client";

import { useEffect, useState } from "react";

const LABELS: Record<string, string> = {
  pending: "Esperando la confirmación de Mercado Pago…",
  paid: "Pago confirmado.",
  failed: "El pago no se completó. Podés intentar de nuevo.",
  in_dispute: "El pago está en disputa.",
  refunded: "El pago fue reembolsado.",
  charged_back: "El pago tuvo un contracargo.",
  needs_review: "Recibimos el pago y lo estamos revisando.",
};

export function Checkout({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Al volver de Mercado Pago se consulta el estado al servidor; los parámetros de la URL
  // (status=approved, etc.) los puede escribir cualquiera.
  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get("order");
    if (!orderId) return;
    let cancelled = false;
    let attempts = 0;
    async function poll() {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId!)}`, { cache: "no-store" });
      if (cancelled) return;
      if (!res.ok) {
        setStatus("unknown");
        return;
      }
      const order = (await res.json()) as { status: string };
      setStatus(order.status);
      if (order.status === "pending" && ++attempts < 20) setTimeout(poll, 3000);
    }
    void poll();
    return () => {
      cancelled = true;
    };
  }, []);

  async function pay() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const data = (await res.json()) as { checkoutUrl?: string };
      if (!res.ok || !data.checkoutUrl) throw new Error();
      window.location.href = data.checkoutUrl;
    } catch {
      setError("No pudimos iniciar el pago. Probá de nuevo en un momento.");
      setLoading(false);
    }
  }

  return (
    <>
      <button onClick={pay} disabled={loading || status === "paid"}>
        {loading ? "Redirigiendo…" : "Pagar con Mercado Pago"}
      </button>
      {error && <div className="status">{error}</div>}
      {status && <div className="status">{LABELS[status] ?? "No encontramos la orden."}</div>}
    </>
  );
}
