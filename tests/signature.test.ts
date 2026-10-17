import { describe, expect, it } from "vitest";
import { buildManifest, parseSignatureHeader, sign, verifySignature } from "@/lib/mercadopago/signature";

const secret = "s3cret";

describe("buildManifest", () => {
  it("follows Mercado Pago's template", () => {
    expect(buildManifest("123", "req-9", "1704908010")).toBe("id:123;request-id:req-9;ts:1704908010;");
  });
  it("omits missing parts and lowercases alphanumeric ids", () => {
    expect(buildManifest("ABC123", null, "1")).toBe("id:abc123;ts:1;");
    expect(buildManifest(null, "r", "1")).toBe("request-id:r;ts:1;");
  });
});

describe("parseSignatureHeader", () => {
  it("parses ts and v1 regardless of order and spacing", () => {
    expect(parseSignatureHeader("v1=ABCD, ts=42")).toEqual({ ts: "42", v1: "abcd" });
  });
  it("rejects incomplete or non-hex headers", () => {
    expect(parseSignatureHeader("ts=42")).toBeNull();
    expect(parseSignatureHeader("ts=abc,v1=ff")).toBeNull();
    expect(parseSignatureHeader("ts=42,v1=zz")).toBeNull();
  });
});

describe("verifySignature", () => {
  const ts = "1704908010";
  const v1 = sign(secret, buildManifest("123", "req", ts));
  const base = { xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req", dataId: "123", secret };

  it("accepts a valid signature", () => {
    expect(verifySignature(base)).toEqual({ ok: true, ts });
  });
  it("rejects a tampered data id", () => {
    expect(verifySignature({ ...base, dataId: "124" })).toEqual({ ok: false, reason: "mismatch" });
  });
  it("rejects a wrong secret", () => {
    expect(verifySignature({ ...base, secret: "other" })).toEqual({ ok: false, reason: "mismatch" });
  });
  it("rejects missing secret, header or malformed header", () => {
    expect(verifySignature({ ...base, secret: "" }).ok).toBe(false);
    expect(verifySignature({ ...base, xSignature: null })).toEqual({ ok: false, reason: "missing_header" });
    expect(verifySignature({ ...base, xSignature: "garbage" })).toEqual({ ok: false, reason: "malformed_header" });
  });
  it("rejects a truncated digest without throwing", () => {
    expect(verifySignature({ ...base, xSignature: `ts=${ts},v1=${v1.slice(0, 10)}` })).toEqual({ ok: false, reason: "mismatch" });
  });
  it("optionally enforces a time window (ts in seconds or ms)", () => {
    const nowMs = Number(ts) * 1000 + 60_000;
    expect(verifySignature({ ...base, toleranceMs: 5 * 60_000, nowMs }).ok).toBe(true);
    expect(verifySignature({ ...base, toleranceMs: 30_000, nowMs })).toEqual({ ok: false, reason: "stale" });
    const tsMs = String(Number(ts) * 1000);
    const v1ms = sign(secret, buildManifest("123", "req", tsMs));
    expect(verifySignature({ ...base, xSignature: `ts=${tsMs},v1=${v1ms}`, toleranceMs: 5 * 60_000, nowMs }).ok).toBe(true);
  });
});
