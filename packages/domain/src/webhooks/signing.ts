// Outbound webhook signing per spec §5.5.
// Format: Ed25519 detached signature over `${kid}.${timestamp}.${body}`.
// Headers:
//   X-Marketplace-Signature: ed25519=<base64url-sig>;kid=<kid>;t=<unix-seconds>
//   Idempotency-Key: <delivery_id>

import { sign as edSign, verify as edVerify, type KeyObject } from "node:crypto";
import { base64url } from "../identity/dpop.js";

export interface WebhookSignatureHeader {
  signature: string;
  kid: string;
  timestamp: number;
}

export function signWebhook(opts: {
  body: string;
  kid: string;
  privateKey: KeyObject;
  now: number;
}): WebhookSignatureHeader {
  const ts = Math.floor(opts.now / 1000);
  const message = `${opts.kid}.${ts}.${opts.body}`;
  const sig = edSign(null, Buffer.from(message), opts.privateKey);
  return { signature: base64url(sig), kid: opts.kid, timestamp: ts };
}

export function formatSignatureHeader(h: WebhookSignatureHeader): string {
  return `ed25519=${h.signature};kid=${h.kid};t=${h.timestamp}`;
}

export function parseSignatureHeader(value: string): WebhookSignatureHeader | null {
  const parts = value.split(";").reduce<Record<string, string>>((acc, kv) => {
    const [k, v] = kv.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const sig = parts["ed25519"];
  const kid = parts["kid"];
  const t = Number(parts["t"]);
  if (!sig || !kid || !Number.isFinite(t)) return null;
  return { signature: sig, kid, timestamp: t };
}

export function verifyWebhook(opts: {
  body: string;
  header: WebhookSignatureHeader;
  publicKey: KeyObject;
  now: number;
  toleranceSeconds?: number;
}): boolean {
  const tol = opts.toleranceSeconds ?? 300;
  const nowSec = Math.floor(opts.now / 1000);
  if (Math.abs(nowSec - opts.header.timestamp) > tol) return false;
  const message = `${opts.header.kid}.${opts.header.timestamp}.${opts.body}`;
  return edVerify(null, Buffer.from(message), opts.publicKey, base64urlDecode(opts.header.signature));
}

function base64urlDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
}
