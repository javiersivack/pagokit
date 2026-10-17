import { createHmac, timingSafeEqual } from "node:crypto";

// Mercado Pago firma cada webhook con el header `x-signature: ts=<ts>,v1=<hex>`.
// v1 = HMAC-SHA256(secret, manifest), con manifest = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
// Si data.id o x-request-id no vienen, esa parte se omite. data.id va en minúsculas.

export type SignatureFailure = "missing_secret" | "missing_header" | "malformed_header" | "stale" | "mismatch";

export type SignatureResult = { ok: true; ts: string } | { ok: false; reason: SignatureFailure };

export interface VerifySignatureInput {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
  // Si se define, rechaza firmas con ts más viejo que esto. No es necesario para seguridad
  // (el handler nunca confía en el payload: siempre vuelve a consultar el pago a la API).
  toleranceMs?: number;
  nowMs?: number;
}

export function parseSignatureHeader(header: string): { ts: string; v1: string } | null {
  const parts: Record<string, string> = {};
  for (const chunk of header.split(",")) {
    const eq = chunk.indexOf("=");
    if (eq === -1) continue;
    parts[chunk.slice(0, eq).trim()] = chunk.slice(eq + 1).trim();
  }
  const { ts, v1 } = parts;
  if (!ts || !v1 || !/^\d+$/.test(ts) || !/^[0-9a-f]+$/i.test(v1)) return null;
  return { ts, v1: v1.toLowerCase() };
}

export function buildManifest(dataId: string | null, xRequestId: string | null, ts: string): string {
  let manifest = "";
  if (dataId) manifest += `id:${dataId.toLowerCase()};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  return `${manifest}ts:${ts};`;
}

export function sign(secret: string, manifest: string): string {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

// ts puede venir en segundos o en milisegundos según la versión del emisor.
function tsToMs(ts: string): number {
  const n = Number(ts);
  return n < 1e12 ? n * 1000 : n;
}

export function verifySignature(input: VerifySignatureInput): SignatureResult {
  if (!input.secret) return { ok: false, reason: "missing_secret" };
  if (!input.xSignature) return { ok: false, reason: "missing_header" };

  const parsed = parseSignatureHeader(input.xSignature);
  if (!parsed) return { ok: false, reason: "malformed_header" };

  if (input.toleranceMs !== undefined) {
    const age = (input.nowMs ?? Date.now()) - tsToMs(parsed.ts);
    if (Math.abs(age) > input.toleranceMs) return { ok: false, reason: "stale" };
  }

  const expected = Buffer.from(sign(input.secret, buildManifest(input.dataId, input.xRequestId, parsed.ts)), "hex");
  const received = Buffer.from(parsed.v1, "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, ts: parsed.ts };
}
