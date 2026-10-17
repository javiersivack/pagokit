# PagoKit — cobros con Mercado Pago en Next.js, sin perder pagos

Starter de Next.js + TypeScript para cobrar con Mercado Pago (Checkout Pro) con los webhooks
bien hechos: firma verificada, estado leído de la API y órdenes que no se rompen con
notificaciones duplicadas o fuera de orden.

> Proyecto independiente. No está afiliado ni avalado por Mercado Pago.

## Qué problemas resuelve

| Problema típico | Qué hace PagoKit |
| --- | --- |
| Cualquiera puede hacer un POST a tu webhook | Verifica `x-signature` (HMAC-SHA256, comparación en tiempo constante) y responde 401 si no coincide. |
| Confiar en `?status=approved` de la URL de retorno | La página consulta el estado al servidor; solo el webhook verificado cambia la orden. |
| Confiar en el cuerpo del webhook | Siempre vuelve a leer el pago con `GET /v1/payments/{id}`. |
| Webhooks duplicados que mandan dos emails | Los efectos se disparan una vez por **cambio de estado** (compare-and-set), no por notificación. |
| Un `pending` que llega después del `approved` | Máquina de estados: solo se aceptan transiciones que avanzan. |
| Se cobra un monto distinto al de la orden (precio que vino del navegador, preferencia vieja, link reutilizado) | Valida monto y moneda contra la orden; si no coinciden, la orden queda en `needs_review`. |
| La API de Mercado Pago falla o tu token está mal | Responde 500 para que Mercado Pago reintente: la notificación no se pierde. |
| Reintentos que duplican cobros | `X-Idempotency-Key` en cada POST; un POST solo se reintenta si lleva esa clave. |
| La notificación de prueba del panel da error | Un id inexistente (404) se confirma con 200 y queda en el log. |

Todo lo anterior está cubierto por tests (`npm test`).

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # completar MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, APP_URL
npm run dev
```

1. **Credenciales:** en [Tus integraciones](https://www.mercadopago.com.ar/developers/panel/app)
   creá una aplicación y copiá el access token de prueba.
2. **Webhooks:** en la misma aplicación → *Webhooks → Configurar notificaciones*, poné la URL
   `https://<tu-dominio>/api/webhooks/mercadopago`, activá el evento **Pagos** y copiá la
   **clave secreta** a `MP_WEBHOOK_SECRET`. En local podés exponer el puerto con un túnel
   (cloudflared, ngrok).
3. **Probar sin túnel:** `MP_WEBHOOK_SECRET=... npm run webhook:test -- <paymentId>` manda un
   webhook firmado igual que Mercado Pago a `localhost:3000`.

## Cómo está armado

```
lib/mercadopago/signature.ts   verificación de x-signature
lib/mercadopago/client.ts      cliente HTTP: timeouts, reintentos con backoff, idempotencia, respuestas validadas con Zod
lib/mercadopago/webhook.ts     handleWebhook(): firma → API → orden → efectos (sin dependencias de Next)
lib/orders.ts                  estados de la orden, transiciones permitidas, interfaz OrderStore
lib/server.ts                  acá se conecta tu base de datos y tus efectos (onStatusChange)
scripts/send-test-webhook.mjs  manda un webhook firmado a tu endpoint local
app/api/checkout               crea la orden y la preferencia (el precio sale del servidor)
app/api/webhooks/mercadopago   endpoint del webhook
app/api/orders/[id]            estado de la orden para la página de retorno
```

### Conectar tu base de datos

El store en memoria sirve para desarrollo: en serverless cada instancia tiene su propia
memoria. Implementá `OrderStore` con tu base. Lo único importante es que `transition` sea
atómico:

```sql
UPDATE orders SET status = $3, payment_id = $4, updated_at = now()
WHERE id = $1 AND status = $2;   -- rowCount = 1 → cambió; 0 → otro webhook ganó
```

### Tus efectos

En `lib/server.ts`, `hooks.onStatusChange(order, from, payment)` se llama una vez por cambio de
estado. Si tu hook falla, el error queda en el log y el estado no se revierte. Si necesitás
garantías de entrega (emails, provisión), usá una tabla outbox.

### Otros topics

`handleWebhook` acepta `topics`: handlers para otros tipos de notificación (por ejemplo
`subscription_preapproval`). Reciben el `data.id` ya verificado por firma y deberían leer el
recurso de la API antes de aplicarlo, igual que con los pagos.

## PagoKit Pro

La edición Pro agrega suscripciones (alta, activación, cobros recurrentes y cancelación),
reembolsos, Postgres con migraciones, un outbox con reintentos para los efectos, un cron de
conciliación para webhooks que nunca llegaron y emails de aviso.

## Comandos

`npm run dev` · `npm test` · `npm run lint` · `npm run typecheck` · `npm run build`

## Licencia

MIT.
