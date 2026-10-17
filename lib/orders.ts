import type { PaymentStatus } from "./mercadopago/schemas";

export type OrderStatus = "pending" | "paid" | "failed" | "in_dispute" | "refunded" | "charged_back" | "needs_review";

export interface Order {
  id: string;
  productId: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  paymentId?: string;
  createdAt: string;
  updatedAt: string;
}

export function mapPaymentStatus(status: string): OrderStatus | null {
  switch (status as PaymentStatus) {
    case "approved":
      return "paid";
    case "pending":
    case "in_process":
    case "authorized": // reservado pero no capturado: todavía no es plata cobrada
      return "pending";
    case "rejected":
    case "cancelled":
      return "failed";
    case "in_mediation":
      return "in_dispute";
    case "refunded":
      return "refunded";
    case "charged_back":
      return "charged_back";
    default:
      return null;
  }
}

// Los webhooks llegan duplicados y fuera de orden: un "pending" puede llegar después del
// "approved". Solo se aceptan transiciones que avanzan; el resto se ignora.
const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["paid", "failed", "in_dispute", "needs_review"],
  // Un pago rechazado no cierra la orden: el comprador puede reintentar con otra tarjeta.
  failed: ["paid", "needs_review"],
  paid: ["in_dispute", "refunded", "charged_back"],
  in_dispute: ["paid", "refunded", "charged_back"],
  refunded: [],
  charged_back: [],
  needs_review: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED[from].includes(to);
}

export interface OrderStore {
  create(order: Order): Promise<void>;
  get(id: string): Promise<Order | null>;
  // Compare-and-set: cambia el estado solo si sigue siendo `from`. En una base de datos es
  // `UPDATE orders SET status = $to ... WHERE id = $id AND status = $from` y se mira rowCount.
  // Así dos webhooks concurrentes no disparan dos veces el mismo efecto.
  transition(id: string, from: OrderStatus, to: OrderStatus, patch?: Partial<Pick<Order, "paymentId">>): Promise<boolean>;
}

// Solo para desarrollo local y tests: en serverless cada instancia tiene su propia memoria.
export function createMemoryStore(): OrderStore {
  const orders = new Map<string, Order>();
  return {
    async create(order) {
      if (orders.has(order.id)) throw new Error(`order ${order.id} already exists`);
      orders.set(order.id, { ...order });
    },
    async get(id) {
      const order = orders.get(id);
      return order ? { ...order } : null;
    },
    async transition(id, from, to, patch) {
      const order = orders.get(id);
      if (!order || order.status !== from) return false;
      orders.set(id, { ...order, ...patch, status: to, updatedAt: new Date().toISOString() });
      return true;
    },
  };
}
