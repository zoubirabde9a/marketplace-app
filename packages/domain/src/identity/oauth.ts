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

export function verifyPkce(verifier: string, challenge: string, method: PkceMethodT): boolean {
  if (method !== "S256") return false;
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
  const iat = Math.floor(input.now / 1000);
  const ttl = Math.min(input.ttlSeconds, 600); // spec §3.6: ≤ 10 min
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
