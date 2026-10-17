import { z } from "zod";

const idLike = z.union([z.string(), z.number()]).transform(String);

// Cuerpo de un webhook. Solo sirve para saber QUÉ cambió: el estado real se consulta a la API.
export const notificationSchema = z
  .object({
    id: idLike.optional(),
    type: z.string().optional(),
    action: z.string().optional(),
    live_mode: z.boolean().optional(),
    data: z.object({ id: idLike }).partial().optional(),
  })
  .passthrough();
export type Notification = z.infer<typeof notificationSchema>;

// Estados conocidos. El schema del pago acepta cualquier string: si Mercado Pago agrega uno
// nuevo, el pago se procesa igual y el estado desconocido no mueve la orden.
export const KNOWN_PAYMENT_STATUSES = [
  "pending",
  "approved",
  "authorized",
  "in_process",
  "in_mediation",
  "rejected",
  "cancelled",
  "refunded",
  "charged_back",
] as const;
export type PaymentStatus = (typeof KNOWN_PAYMENT_STATUSES)[number];

export const paymentSchema = z
  .object({
    id: idLike,
    status: z.string(),
    status_detail: z.string().nullish(),
    external_reference: z.string().nullish(),
    transaction_amount: z.number(),
    currency_id: z.string(),
    live_mode: z.boolean().optional(),
    date_approved: z.string().nullish(),
  })
  .passthrough();
export type Payment = z.infer<typeof paymentSchema>;

export const preferenceItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().positive(),
  currency_id: z.string().length(3),
});

export const createPreferenceSchema = z.object({
  items: z.array(preferenceItemSchema).min(1),
  external_reference: z.string().min(1),
  payer: z.object({ email: z.string().email() }).partial().optional(),
  back_urls: z.object({ success: z.string().url(), failure: z.string().url(), pending: z.string().url() }).optional(),
  auto_return: z.enum(["approved", "all"]).optional(),
  notification_url: z.string().url().optional(),
  expires: z.boolean().optional(),
  expiration_date_to: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreatePreferenceInput = z.infer<typeof createPreferenceSchema>;

export const preferenceSchema = z
  .object({
    id: z.string(),
    init_point: z.string().url(),
    sandbox_init_point: z.string().url().optional(),
  })
  .passthrough();
export type Preference = z.infer<typeof preferenceSchema>;
