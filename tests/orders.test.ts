import { describe, expect, it } from "vitest";
import { canTransition, createMemoryStore, mapPaymentStatus } from "@/lib/orders";
import { order } from "./helpers";

describe("mapPaymentStatus", () => {
  it("maps Mercado Pago statuses to order statuses", () => {
    expect(mapPaymentStatus("approved")).toBe("paid");
    expect(mapPaymentStatus("authorized")).toBe("pending");
    expect(mapPaymentStatus("in_process")).toBe("pending");
    expect(mapPaymentStatus("rejected")).toBe("failed");
    expect(mapPaymentStatus("in_mediation")).toBe("in_dispute");
    expect(mapPaymentStatus("charged_back")).toBe("charged_back");
    expect(mapPaymentStatus("something_new")).toBeNull();
  });
});

describe("canTransition", () => {
  it("never moves a paid order back to pending", () => {
    expect(canTransition("paid", "pending")).toBe(false);
    expect(canTransition("paid", "refunded")).toBe(true);
  });
  it("lets a failed order be paid by a retry", () => {
    expect(canTransition("failed", "paid")).toBe(true);
  });
  it("keeps terminal states terminal", () => {
    expect(canTransition("refunded", "paid")).toBe(false);
    expect(canTransition("needs_review", "paid")).toBe(false);
  });
});

describe("memory store", () => {
  it("only transitions when the current status matches", async () => {
    const store = createMemoryStore();
    await store.create(order());
    expect(await store.transition("order-1", "pending", "paid", { paymentId: "1" })).toBe(true);
    expect(await store.transition("order-1", "pending", "paid")).toBe(false);
    expect(await store.get("order-1")).toMatchObject({ status: "paid", paymentId: "1" });
  });
});
