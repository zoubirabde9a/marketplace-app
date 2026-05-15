// Marketplace session JWT. Signed with the existing minimal-issuer Ed25519 key.
// Used as a Bearer credential for end-user (human) endpoints. Distinct from
// Agent Passports (which authenticate agents acting on behalf of a user).

import { sign, verify, type KeyObject } from "node:crypto";

const HEADER_TYP = "mp-session+jwt";
const ALG = "EdDSA";
const PREFIX = "mp_"; // distinguishes from raw JWT bearer tokens

export interface SessionClaims {
  iss: string;
  sub: string; // userId
  email: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface SessionIssuerKey {
  kid: string;
  privateKey: KeyObject;
}

export interface SessionVerifierKey {
  kid: string;
  publicKey: KeyObject;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function signSession(claims: SessionClaims, issuer: SessionIssuerKey): string {
  const header = { alg: ALG, typ: HEADER_TYP, kid: issuer.kid };
  const headerB64 = b64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = sign(null, Buffer.from(signingInput), issuer.privateKey);
  return `${PREFIX}${signingInput}.${b64url(sig)}`;
}

export interface VerifySessionOptions {
  audience: string;
  now: number;
  resolveKey: (kid: string) => Promise<KeyObject | undefined>;
}

export async function verifySession(token: string, opts: VerifySessionOptions): Promise<SessionClaims> {
  if (!token.startsWith(PREFIX)) throw new Error("session_format");
  const raw = token.slice(PREFIX.length);
  const parts = raw.split(".");
  if (parts.length !== 3) throw new Error("session_malformed");
  const [hB64, pB64, sB64] = parts as [string, string, string];

  const header = JSON.parse(b64urlDecode(hB64).toString("utf8")) as Record<string, unknown>;
  if (header["typ"] !== HEADER_TYP || header["alg"] !== ALG) throw new Error("session_header");
  const kid = String(header["kid"] ?? "");
  const key = await opts.resolveKey(kid);
  // Collapse "kid not registered" and "signature mismatch" into one error.
  // Returning a distinct `session_unknown_kid` lets an attacker submit
  // forged session tokens with candidate kids and use the response code
  // to enumerate which kids the platform's session-signing registry knows
  // about. Same kid-enumeration oracle the mandate verifier closed.
  if (!key) throw new Error("session_signature");

  const ok = verify(null, Buffer.from(`${hB64}.${pB64}`), key, b64urlDecode(sB64));
  if (!ok) throw new Error("session_signature");

  const claims = JSON.parse(b64urlDecode(pB64).toString("utf8")) as SessionClaims;
  // Runtime type-check critical claims. The `as SessionClaims` cast trusts
  // JSON.parse — if a forged payload (signature would already be invalid in
  // practice, but defense-in-depth against a same-kid key compromise or a
  // future bug that defers signature check) contained `exp: "abc"`, the
  // comparison `"abc" <= nowSec` evaluates to `false` and the token is
  // accepted as never-expiring. Force exp/iat to be finite numbers and
  // sub/email to be strings before any business-logic gate keys off them.
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) {
    throw new Error("session_exp_invalid");
  }
  if (typeof claims.iat !== "number" || !Number.isFinite(claims.iat)) {
    throw new Error("session_iat_invalid");
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new Error("session_sub_invalid");
  }
  if (typeof claims.email !== "string" || claims.email.length === 0) {
    throw new Error("session_email_invalid");
  }
  if (claims.aud !== opts.audience) throw new Error("session_audience");
  const nowSec = Math.floor(opts.now / 1000);
  if (claims.exp <= nowSec) throw new Error("session_expired");
  return claims;
}

export function isSessionToken(bearer: string): boolean {
  return bearer.startsWith(PREFIX);
}

// ── Agent-issued login link tokens ─────────────────────────────────────────
//
// A short-lived JWT signed by the same Ed25519 key as session tokens. An agent
// (authenticated by its passport) mints one of these for a user it acts on
// behalf of, sends the URL to the user out-of-band, and the user exchanges it
// at `/login?code=…` for a real session cookie. Stateless — no DB required.
//
// Lifetime: 10 minutes by default. Stateless replay protection is intentionally
// omitted (the short TTL bounds the blast radius). If we later need
// single-use guarantees, swap to a DB-backed token store.

const LINK_HEADER_TYP = "mp-link+jwt";
const LINK_PREFIX = "mpl_";
const LINK_DEFAULT_TTL_SECS = 10 * 60;

export interface LinkTokenClaims {
  iss: string;
  sub: string; // userId the agent is acting on behalf of
  agent_id: string; // the agent that minted the link
  passport_id: string; // the passport jti used to mint it (audit)
  aud: string;
  iat: number;
  exp: number;
}

export function signLinkToken(claims: LinkTokenClaims, issuer: SessionIssuerKey): string {
  const header = { alg: ALG, typ: LINK_HEADER_TYP, kid: issuer.kid };
  const headerB64 = b64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = sign(null, Buffer.from(signingInput), issuer.privateKey);
  return `${LINK_PREFIX}${signingInput}.${b64url(sig)}`;
}

export interface VerifyLinkTokenOptions {
  audience: string;
  now: number;
  resolveKey: (kid: string) => Promise<KeyObject | undefined>;
}

export async function verifyLinkToken(token: string, opts: VerifyLinkTokenOptions): Promise<LinkTokenClaims> {
  if (!token.startsWith(LINK_PREFIX)) throw new Error("link_format");
  const raw = token.slice(LINK_PREFIX.length);
  const parts = raw.split(".");
  if (parts.length !== 3) throw new Error("link_malformed");
  const [hB64, pB64, sB64] = parts as [string, string, string];

  const header = JSON.parse(b64urlDecode(hB64).toString("utf8")) as Record<string, unknown>;
  if (header["typ"] !== LINK_HEADER_TYP || header["alg"] !== ALG) throw new Error("link_header");
  const kid = String(header["kid"] ?? "");
  const key = await opts.resolveKey(kid);
  // Same kid-enumeration mitigation as verifySession — collapse into the
  // generic signature error so unauthenticated probes can't map the
  // platform's link-token signer registry by forging tokens.
  if (!key) throw new Error("link_signature");

  const ok = verify(null, Buffer.from(`${hB64}.${pB64}`), key, b64urlDecode(sB64));
  if (!ok) throw new Error("link_signature");

  const claims = JSON.parse(b64urlDecode(pB64).toString("utf8")) as LinkTokenClaims;
  // Same runtime type-check as verifySession — without it, a payload with
  // `exp: "abc"` would compare `"abc" <= nowSec` as false and yield a
  // never-expiring link token. Defense-in-depth past the signature check.
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) {
    throw new Error("link_exp_invalid");
  }
  if (typeof claims.iat !== "number" || !Number.isFinite(claims.iat)) {
    throw new Error("link_iat_invalid");
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new Error("link_sub_invalid");
  }
  if (typeof claims.agent_id !== "string" || claims.agent_id.length === 0) {
    throw new Error("link_agent_id_invalid");
  }
  if (claims.aud !== opts.audience) throw new Error("link_audience");
  const nowSec = Math.floor(opts.now / 1000);
  if (claims.exp <= nowSec) throw new Error("link_expired");
  return claims;
}

export function defaultLinkTokenTtlSecs(): number {
  return LINK_DEFAULT_TTL_SECS;
}
