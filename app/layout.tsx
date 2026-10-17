import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PagoKit — Mercado Pago para Next.js",
  description: "Cobros con Mercado Pago con webhooks firmados y verificados del lado del servidor.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
