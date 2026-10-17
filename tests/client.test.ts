import { describe, expect, it, vi } from "vitest";
import { createClient, MercadoPagoError } from "@/lib/mercadopago/client";

const paymentJson = { id: 111, status: "approved", external_reference: "o", transaction_amount: 10, currency_id: "ARS" };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function client(fetchImpl: typeof fetch, maxRetries = 2) {
  return createClient({ accessToken: "TEST-token", fetchImpl, maxRetries, sleep: async () => {} });
}

describe("createClient", () => {
  it("fetches a payment with the bearer token and normalizes the id", async () => {
    const fetchImpl = vi.fn(async () => json(200, paymentJson));
    const payment = await client(fetchImpl as unknown as typeof fetch).getPayment("111");
    expect(payment.id).toBe("111");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/v1/payments/111");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TEST-token");
  });

  it("retries 429 and 5xx, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(429, {}))
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(200, paymentJson));
    await expect(client(fetchImpl).getPayment("111")).resolves.toMatchObject({ status: "approved" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries network errors and gives up as retryable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const err = await client(fetchImpl, 1).getPayment("111").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MercadoPagoError);
    expect((err as MercadoPagoError).retryable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(404, { message: "not found" }));
    const err = (await client(fetchImpl).getPayment("1").catch((e: unknown) => e)) as MercadoPagoError;
    expect(err.status).toBe(404);
    expect(err.retryable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects non-numeric payment ids before calling the API", async () => {
    const fetchImpl = vi.fn();
    await expect(client(fetchImpl).getPayment("../users/me")).rejects.toBeInstanceOf(MercadoPagoError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("flags responses with an unexpected shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { id: 1 }));
    await expect(client(fetchImpl).getPayment("1")).rejects.toThrow(/unexpected response shape/);
  });

  it("sends the idempotency key on preference creation and retries safely", async () => {
    const pref = { id: "pref-1", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1" };
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(500, {})).mockResolvedValueOnce(json(201, pref));
    const input = {
      items: [{ title: "Plan", quantity: 1, unit_price: 10, currency_id: "ARS" }],
      external_reference: "order-1",
    };
    await expect(client(fetchImpl).createPreference(input, "key-1")).resolves.toMatchObject({ id: "pref-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const init = fetchImpl.mock.calls[1]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Idempotency-Key"]).toBe("key-1");
    expect(JSON.parse(init.body as string)).toEqual(input);
  });
});
