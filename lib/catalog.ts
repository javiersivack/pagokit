// El precio sale del servidor, nunca del navegador. Reemplazá esto por tu base de datos.
export interface Product {
  id: string;
  title: string;
  price: number;
  currency: string;
}

export const CATALOG: Record<string, Product> = {
  "plan-pro": { id: "plan-pro", title: "Plan Pro (pago único)", price: 1500, currency: "ARS" },
};
