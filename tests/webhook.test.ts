import { describe, expect, it, vi } from "vitest";
import { MercadoPagoError } from "@/lib/mercadopago/client";
import type { Payment } from "@/lib/mercadopago/schemas";
import { handleWebhook, type WebhookDeps } from "@/lib/mercadopago/webhook";
import type { OrderStore } from "@/lib/orders";
import { order, payment, SECRET, signedRequest, storeWith } from "./helpers";

function deps(store: OrderStore, getPayment: (id: string) => Promise<Payment>, extra: Partial<WebhookDeps> = {}): WebhookDeps {
  return { secret: SECRET, client: { getPayment }, store, ...extra };
}

describe("handleWebhook", () => {
  it("marks the order paid after verifying the payment with the API", async () => {
    const store = await storeWith(order());
    const onStatusChange = vi.fn();
    const getPayment = vi.fn(async () => payment());
    const result = await handleWebhook(signedRequest("111"), deps(store, getPayment, { hooks: { onStatusChange } }));

    expect(result).toEqual({ status: 200, outcome: "updated", orderId: "order-1", orderStatus: "paid" });
    expect(getPayment).toHaveBeenCalledWith("111");
    expect(await store.get("order-1")).toMatchObject({ status: "paid", paymentId: "111" });
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange.mock.calls[0]![1]).toBe("pending");
  });

  it("rejects an unsigned or forged notification without calling the API", async () => {
    const store = await storeWith(order());
    const getPayment = vi.fn(async () => payment());
    const forged = signedRequest("111", { secret: "attacker" });
    expect(await handleWebhook(forged, deps(store, getPayment))).toMatchObject({ status: 401, outcome: "invalid_signature" });

    const unsigned = { ...signedRequest("111"), headers: new Headers() };
    expect((await handleWebhook(unsigned, deps(store, getPayment))).status).toBe(401);
    expect(getPayment).not.toHaveBeenCalled();
  });

  it("rejects a valid signature replayed with a different payment id in the query", async () => {
    const store = await storeWith(order());
    const req = signedRequest("111");
    const replay = { ...req, url: req.url.replace("data.id=111", "data.id=999") };
    expect((await handleWebhook(replay, deps(store, async () => payment()))).status).toBe(401);
  });

  it("fires side effects once for duplicated notifications", async () => {
    const store = await storeWith(order());
    const onStatusChange = vi.fn();
    const d = deps(store, async () => payment(), { hooks: { onStatusChange } });
    await handleWebhook(signedRequest("111"), d);
    const second = await handleWebhook(signedRequest("111", { requestId: "req-2" }), d);
    expect(second.outcome).toBe("no_change");
    expect(onStatusChange).toHaveBeenCalledTimes(1);
  });

  it("ignores a late 'pending' that arrives after 'approved'", async () => {
    const store = await storeWith(order({ status: "paid", paymentId: "111" }));
    const result = await handleWebhook(signedRequest("111"), deps(store, async () => payment({ status: "pending" })));
    expect(result.outcome).toBe("no_change");
    expect((await store.get("order-1"))?.status).toBe("paid");
  });

  it("handles concurrent notifications for the same payment with a single effect", async () => {
    const store = await storeWith(order());
    const onStatusChange = vi.fn();
    const d = deps(store, async () => payment(), { hooks: { onStatusChange } });
    const results = await Promise.all([
      handleWebhook(signedRequest("111"), d),
      handleWebhook(signedRequest("111", { requestId: "req-2" }), d),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["no_change", "updated"]);
    expect(onStatusChange).toHaveBeenCalledTimes(1);
  });

  it("does not mark paid when the amount or currency differs from the order", async () => {
    const store = await storeWith(order());
    const cheap = await handleWebhook(signedRequest("111"), deps(store, async () => payment({ transaction_amount: 1 })));
    expect(cheap).toMatchObject({ outcome: "amount_mismatch", orderStatus: "needs_review" });

    const store2 = await storeWith(order());
    const usd = await handleWebhook(signedRequest("111"), deps(store2, async () => payment({ currency_id: "USD" })));
    expect(usd.orderStatus).toBe("needs_review");
  });

  it("tolerates float rounding in the amount", async () => {
    const store = await storeWith(order({ amount: 10.1 }));
    const result = await handleWebhook(signedRequest("111"), deps(store, async () => payment({ transaction_amount: 10.100000001 })));
    expect(result.orderStatus).toBe("paid");
  });

  it("lets a retry with another card pay a failed order", async () => {
    const store = await storeWith(order());
    await handleWebhook(signedRequest("111"), deps(store, async () => payment({ status: "rejected" })));
    expect((await store.get("order-1"))?.status).toBe("failed");
    const result = await handleWebhook(signedRequest("222"), deps(store, async () => payment({ id: "222" })));
    expect(result.orderStatus).toBe("paid");
    expect((await store.get("order-1"))?.paymentId).toBe("222");
  });

  it("does not let a different payment's refund or rejection touch a paid order", async () => {
    const store = await storeWith(order({ status: "paid", paymentId: "111" }));
    const refundOther = await handleWebhook(signedRequest("222"), deps(store, async () => payment({ id: "222", status: "refunded" })));
    expect(refundOther.outcome).toBe("no_change");
    expect((await store.get("order-1"))?.status).toBe("paid");
  });

  it("applies a refund of the payment that paid the order", async () => {
    const store = await storeWith(order({ status: "paid", paymentId: "111" }));
    const result = await handleWebhook(signedRequest("111"), deps(store, async () => payment({ status: "refunded" })));
    expect(result.orderStatus).toBe("refunded");
  });

  it("asks Mercado Pago to retry when the API is down", async () => {
    const store = await storeWith(order());
    const down = async () => {
      throw new MercadoPagoError("timeout", null, true);
    };
    expect(await handleWebhook(signedRequest("111"), deps(store, down))).toEqual({ status: 500, outcome: "retry_later" });
    expect((await store.get("order-1"))?.status).toBe("pending");
  });

  it("asks for a retry when the access token is rejected, so no notification is lost", async () => {
    const store = await storeWith(order());
    const unauthorized = async () => {
      throw new MercadoPagoError("unauthorized", 401, false);
    };
    expect(await handleWebhook(signedRequest("111"), deps(store, unauthorized))).toEqual({ status: 500, outcome: "retry_later" });
  });

  it("acknowledges the dashboard's test notification (unknown payment id)", async () => {
    const store = await storeWith(order());
    const notFound = async () => {
      throw new MercadoPagoError("not found", 404, false);
    };
    expect(await handleWebhook(signedRequest("123456"), deps(store, notFound))).toEqual({ status: 200, outcome: "payment_not_found" });
  });

  it("acknowledges and ignores other topics and unknown orders", async () => {
    const store = await storeWith(order());
    const getPayment = vi.fn(async () => payment({ external_reference: "nope" }));
    expect((await handleWebhook(signedRequest("1", { type: "merchant_order" }), deps(store, getPayment))).outcome).toBe("ignored_type");
    expect((await handleWebhook(signedRequest("111"), deps(store, getPayment))).outcome).toBe("order_not_found");
  });

  it("rejects test payments when live mode is required", async () => {
    const store = await storeWith(order());
    const result = await handleWebhook(
      signedRequest("111"),
      deps(store, async () => payment({ live_mode: false }), { requireLiveMode: true }),
    );
    expect(result.outcome).toBe("test_payment_rejected");
    expect((await store.get("order-1"))?.status).toBe("pending");
  });

  it("keeps the new status even if the side-effect hook throws", async () => {
    const store = await storeWith(order());
    const onStatusChange = vi.fn(async () => {
      throw new Error("email down");
    });
    const result = await handleWebhook(signedRequest("111"), deps(store, async () => payment(), { hooks: { onStatusChange } }));
    expect(result).toMatchObject({ status: 200, outcome: "updated" });
  });

  it("with defer, answers before running the side-effect hook", async () => {
    const store = await storeWith(order());
    const onStatusChange = vi.fn();
    const deferred: Array<() => Promise<void>> = [];
    const result = await handleWebhook(
      signedRequest("111"),
      deps(store, async () => payment(), { hooks: { onStatusChange }, defer: (task) => void deferred.push(task) }),
    );
    expect(result).toMatchObject({ status: 200, outcome: "updated" });
    expect(onStatusChange).not.toHaveBeenCalled();
    await deferred[0]!();
    expect(onStatusChange).toHaveBeenCalledTimes(1);
  });

  it("with defer, a failing hook is logged and does not throw", async () => {
    const store = await storeWith(order());
    const error = vi.fn();
    const deferred: Array<() => Promise<void>> = [];
    await handleWebhook(
      signedRequest("111"),
      deps(store, async () => payment(), {
        hooks: { onStatusChange: async () => { throw new Error("email down"); } },
        logger: { info() {}, warn() {}, error },
        defer: (task) => void deferred.push(task),
      }),
    );
    await expect(deferred[0]!()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("onStatusChange hook failed", expect.anything());
  });
});
