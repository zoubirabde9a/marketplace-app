// OAuth 2.1 Authorization Code + PKCE.
// Mandate-bound access tokens reference an AP2 mandate id via the `mandate_id` claim.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { base64url } from "./dpop.js";

export const PkceMethod = z.enum(["S256"]); // plain not allowed under OAuth 2.1
export type PkceMethodT = z.infer<typeof PkceMethod>;

export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

export function codeChallengeS256(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

// RFC 7636 §4.1 — code verifier MUST be 43–128 unreserved characters. Without
// this bound a client could submit a too-short verifier (or even an empty
// string, whose SHA-256 challenge is a well-known constant) and pass the hash
// equality check. The challenge-verifier binding only holds when the verifier
// has the required entropy.
const PKCE_VERIFIER_MIN_LEN = 43;
const PKCE_VERIFIER_MAX_LEN = 128;
const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]+$/;

export function verifyPkce(verifier: string, challenge: string, method: PkceMethodT): boolean {
  if (method !== "S256") return false;
  if (
    verifier.length < PKCE_VERIFIER_MIN_LEN ||
    verifier.length > PKCE_VERIFIER_MAX_LEN ||
    !PKCE_VERIFIER_RE.test(verifier)
  ) {
    return false;
  }
  const computed = codeChallengeS256(verifier);
  if (computed.length !== challenge.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

export const AuthCodeSchema = z.object({
  code: z.string(),
  clientId: z.string(),
  redirectUri: z.string(),
  scopes: z.array(z.string()),
  codeChallenge: z.string(),
  codeChallengeMethod: PkceMethod,
  userId: z.string().optional(),
  agentId: z.string().optional(),
  mandateId: z.string().optional(),
  dpopJkt: z.string().optional(),
  expiresAt: z.number(),
});
export type AuthCode = z.infer<typeof AuthCodeSchema>;

export const TokenIntrospectionSchema = z.object({
  active: z.boolean(),
  scope: z.string().optional(),
  client_id: z.string().optional(),
  username: z.string().optional(),
  token_type: z.literal("DPoP").optional(),
  exp: z.number().optional(),
  iat: z.number().optional(),
  sub: z.string().optional(),
  aud: z.string().optional(),
  cnf: z.object({ jkt: z.string() }).optional(),
  mandate_id: z.string().optional(),
});
export type TokenIntrospection = z.infer<typeof TokenIntrospectionSchema>;

export interface AccessTokenIssueInput {
  sub: string;
  aud: string;
  scopes: string[];
  dpopJkt: string;
  ttlSeconds: number;
  mandateId?: string;
  now: number;
  signer: (claims: Record<string, unknown>) => Promise<string>;
}

export async function issueAccessToken(input: AccessTokenIssueInput): Promise<{
  token: string;
  expiresAt: number;
}> {
  // OAuth scopes are space-separated by spec — a scope containing whitespace
  // would concatenate into a phantom additional scope on the wire ("a b" →
  // ["a", "b"]). Reject at the issuer so a poisoned mandate or session
  // header can't smuggle scopes via space-injection.
  for (const s of input.scopes) {
    if (s.length === 0 || /\s/.test(s)) {
      throw new Error(`oauth_invalid_scope:${JSON.stringify(s)}`);
    }
  }
  const iat = Math.floor(input.now / 1000);
  // Bound TTL on both ends. Upper bound is spec §3.6 (≤10 min). Lower bound
  // is 60s — a negative/zero ttlSeconds would otherwise produce a token whose
  // `exp <= iat`, expiring at issuance, which downstream silently treats as
  // "invalid token" and looks like a flaky outage.
  // Reject non-finite TTLs explicitly first — `Math.min(NaN, 600) = NaN`,
  // `Math.max(60, NaN) = NaN`, so an upstream that passes `Number.NaN` /
  // `Infinity` (e.g. from a misconfigured client policy parse) would
  // produce `exp = iat + NaN = NaN`. JWT exp claims that are non-numeric
  // are treated by some verifiers as "no expiry" — a forever-valid
  // access token issued in error. Fail loudly instead.
  if (!Number.isFinite(input.ttlSeconds)) {
    throw new Error("oauth_invalid_ttl_non_finite");
  }
  const ttl = Math.max(60, Math.min(input.ttlSeconds, 600));
  const exp = iat + ttl;
  const claims: Record<string, unknown> = {
    sub: input.sub,
    aud: input.aud,
    iat,
    exp,
    scope: input.scopes.join(" "),
    cnf: { jkt: input.dpopJkt },
    token_type: "DPoP",
  };
  if (input.mandateId) claims["mandate_id"] = input.mandateId;
  const token = await input.signer(claims);
  return { token, expiresAt: exp };
}
