// DPoP (RFC 9449) verification — sender-constrained access tokens.
// Verifies the JWS over the DPoP proof header, jti freshness, htm/htu binding, and
// (optionally) the access-token hash (`ath`) claim.
//
// We use Web Crypto via Node's native subtle. Supported alg: EdDSA (Ed25519) and ES256.

import { createHash } from "node:crypto";
import { UnauthorizedError } from "@marketplace/shared/errors";

export interface DpopVerifyOptions {
  /** HTTP method, uppercase ("GET", "POST", …). */
  htm: string;
  /** Full request URL without query string and fragment. */
  htu: string;
  /** Optional access token whose SHA-256 must be the proof's `ath` claim. */
  accessToken?: string;
  /** Maximum proof age in seconds (default 60). */
  maxAgeSeconds?: number;
  /** jti replay-cache lookup; throws if jti was already seen. */
  jtiSeen: (jti: string, expiresAtMs: number) => Promise<boolean>;
  /** Current time provider. */
  now: () => number;
}

export interface DpopVerifyResult {
  jkt: string; // JWK SHA-256 thumbprint, matches the bound access token's `cnf.jkt`
  jwk: Record<string, unknown>;
  jti: string;
  iat: number;
}

const SUPPORTED_ALG = new Set(["EdDSA", "ES256"]);

export async function verifyDpop(proofJwt: string, opts: DpopVerifyOptions): Promise<DpopVerifyResult> {
  const parts = proofJwt.split(".");
  if (parts.length !== 3) throw new UnauthorizedError("dpop_malformed");
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const header = decodeJson(headerB64);
  const payload = decodeJson(payloadB64);

  if (header["typ"] !== "dpop+jwt") throw new UnauthorizedError("dpop_typ");
  const alg = String(header["alg"] ?? "");
  if (!SUPPORTED_ALG.has(alg)) throw new UnauthorizedError("dpop_alg");
  const jwk = header["jwk"];
  if (!jwk || typeof jwk !== "object") throw new UnauthorizedError("dpop_jwk_missing");

  // Verify the signature FIRST, before any payload-derived checks or jti
  // consumption. Two reasons:
  //   1. The specific error codes for payload mismatches (htm/htu/iat/ath/jti)
  //      leak server state to an attacker who can submit forged proofs and
  //      probe the responses ("this jti was already used", "ath_mismatch
  //      means the access token is valid"). Signature-first means an
  //      unsigned/forged proof always fails with the same `dpop_signature`
  //      regardless of payload contents.
  //   2. Pre-signature jti consumption was a denial-of-service vector: an
  //      attacker who guessed/snooped a future jti could submit a forged
  //      proof first, the server would call `jtiSeen` and ADD the jti to
  //      the replay cache, and the legitimate client's later valid proof
  //      would then be rejected as `dpop_jti_replay`.
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64urlDecode(sigB64);
  // Wrap importJwk in a try/catch and surface as the same `dpop_signature`
  // error any other signature failure produces. Pre-fix a malformed JWK
  // (wrong kty/alg pairing, invalid curve, missing required member) would
  // make `crypto.subtle.importKey` throw a generic DOMException / Error
  // that bubbled out of verifyDpop unhandled. Two issues with that:
  //   1. The error message can disclose JWK-shape details to an attacker
  //      probing with crafted JWKs ("Unsupported key usage", "Invalid
  //      curve", etc.).
  //   2. It surfaces in the API layer's error handler as a 500 rather than
  //      a 401 — confusing operationally and turns every malformed-JWK
  //      probe into a metric spike on `unhandled_error`.
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await importJwk(jwk as Record<string, unknown>, alg);
  } catch {
    throw new UnauthorizedError("dpop_signature");
  }
  const ok = await crypto.subtle.verify(
    algParams(alg),
    cryptoKey,
    signature as BufferSource,
    signingInput as BufferSource,
  );
  if (!ok) throw new UnauthorizedError("dpop_signature");

  const htm = String(payload["htm"] ?? "");
  const htu = String(payload["htu"] ?? "");
  if (htm !== opts.htm) throw new UnauthorizedError("dpop_htm_mismatch");
  if (normalizeUrl(htu) !== normalizeUrl(opts.htu)) throw new UnauthorizedError("dpop_htu_mismatch");

  const iat = Number(payload["iat"] ?? 0);
  const now = Math.floor(opts.now() / 1000);
  const maxAge = opts.maxAgeSeconds ?? 60;
  if (!Number.isFinite(iat) || Math.abs(now - iat) > maxAge) {
    throw new UnauthorizedError("dpop_iat_out_of_window");
  }

  const jti = String(payload["jti"] ?? "");
  if (!jti) throw new UnauthorizedError("dpop_jti_missing");

  if (opts.accessToken !== undefined) {
    const expectedAth = base64url(createHash("sha256").update(opts.accessToken).digest());
    if (payload["ath"] !== expectedAth) throw new UnauthorizedError("dpop_ath_mismatch");
  }

  // Replay protection — only consume the jti once the signature has proved
  // the proof was actually issued by the bound keypair.
  const expiresAtMs = (iat + maxAge) * 1000;
  const seen = await opts.jtiSeen(jti, expiresAtMs);
  if (seen) throw new UnauthorizedError("dpop_jti_replay");

  const jkt = await jwkThumbprint(jwk as Record<string, unknown>);
  return { jkt, jwk: jwk as Record<string, unknown>, jti, iat };
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return u;
  }
}

function decodeJson(b64: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64urlDecode(b64))) as Record<string, unknown>;
}

export function base64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function base64urlDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
}

function algParams(alg: string): AlgorithmIdentifier | EcdsaParams {
  if (alg === "EdDSA") return { name: "Ed25519" };
  return { name: "ECDSA", hash: "SHA-256" } as EcdsaParams;
}

async function importJwk(jwk: Record<string, unknown>, alg: string): Promise<CryptoKey> {
  const keyAlg = alg === "EdDSA" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" };
  return crypto.subtle.importKey("jwk", jwk as JsonWebKey, keyAlg, false, ["verify"]);
}

export async function jwkThumbprint(jwk: Record<string, unknown>): Promise<string> {
  // RFC 7638 thumbprint for the canonical members per kty.
  const kty = String(jwk["kty"] ?? "");
  let canonical: Record<string, unknown>;
  if (kty === "EC") canonical = { crv: jwk["crv"], kty, x: jwk["x"], y: jwk["y"] };
  else if (kty === "OKP") canonical = { crv: jwk["crv"], kty, x: jwk["x"] };
  else if (kty === "RSA") canonical = { e: jwk["e"], kty, n: jwk["n"] };
  else throw new UnauthorizedError("dpop_jwk_kty");
  const json = JSON.stringify(canonical, Object.keys(canonical).sort());
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return base64url(Buffer.from(hash));
}
