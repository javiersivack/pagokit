import { CATALOG } from "@/lib/catalog";
import { Checkout } from "./Checkout";

export default function Home() {
  const product = CATALOG["plan-pro"]!;
  return (
    <main>
      <h1>PagoKit</h1>
      <p>Checkout de ejemplo. El pago se confirma solo cuando llega el webhook firmado y el servidor verifica el pago en la API de Mercado Pago.</p>
      <div className="card">
        <strong>{product.title}</strong>
        <div className="price">
          {product.currency} {product.price.toLocaleString("es-AR")}
        </div>
        <Checkout productId={product.id} />
      </div>
    </main>
  );
}
