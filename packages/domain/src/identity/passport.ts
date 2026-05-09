// Agent Passport: signed credential binding an agent identity to capability scopes,
// spend caps, allow/deny lists, expiry, and audit-trail commitment. Spec §3.2.

import { z } from "zod";
import { newId } from "@marketplace/shared/ids";
import { sign, verify, generateKeyPairSync, createPublicKey, type KeyObject } from "node:crypto";
import { base64url, base64urlDecode } from "./dpop.js";

export const PassportClaimsSchema = z.object({
  iss: z.string(),
  sub: z.string(), // agent id
  aud: z.string(), // marketplace audience
  jti: z.string(), // passport id
  iat: z.number(),
  exp: z.number(),
  cnf: z.object({ jwk: z.record(z.string(), z.unknown()) }), // bound key
  scopes: z.array(z.string()),
  spend_caps: z.object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    per_tx_minor: z.string().optional(),
    per_day_minor: z.string().optional(),
    per_merchant_minor: z.string().optional(),
  }),
  allow_merchants: z.array(z.string()).optional(),
  deny_merchants: z.array(z.string()).optional(),
  allow_categories: z.array(z.string()).optional(),
  deny_categories: z.array(z.string()).optional(),
  audit_root: z.string().optional(),
  owner: z.object({ kind: z.enum(["user", "org"]), id: z.string() }),
});
export type PassportClaims = z.infer<typeof PassportClaimsSchema>;

export interface SignedPassport {
  jwt: string;
  passportId: string;
  expiresAt: number;
}

export interface IssuerKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  alg: "EdDSA";
}

export function generateIssuerKey(kid: string): IssuerKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { kid, publicKey, privateKey, alg: "EdDSA" };
}

export function signPassport(claims: PassportClaims, issuer: IssuerKey): SignedPassport {
  const header = { alg: issuer.alg, typ: "passport+jwt", kid: issuer.kid };
  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = sign(null, Buffer.from(signingInput), issuer.privateKey);
  const jwt = `${signingInput}.${base64url(sig)}`;
  return { jwt, passportId: claims.jti, expiresAt: claims.exp };
}

export interface VerifyPassportOptions {
  audience: string;
  now: number;
  resolveIssuerKey: (kid: string) => Promise<KeyObject | undefined>;
  isRevoked: (passportId: string) => Promise<boolean>;
}

export async function verifyPassport(jwt: string, opts: VerifyPassportOptions): Promise<PassportClaims> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("passport_malformed");
  const [hB64, pB64, sB64] = parts as [string, string, string];

  const header = JSON.parse(new TextDecoder().decode(base64urlDecode(hB64))) as Record<string, unknown>;
  if (header["typ"] !== "passport+jwt" || header["alg"] !== "EdDSA") {
    throw new Error("passport_header");
  }
  const kid = String(header["kid"] ?? "");
  const issuerKey = await opts.resolveIssuerKey(kid);
  if (!issuerKey) throw new Error("passport_unknown_kid");

  const ok = verify(
    null,
    Buffer.from(`${hB64}.${pB64}`),
    issuerKey,
    Buffer.from(base64urlDecode(sB64)),
  );
  if (!ok) throw new Error("passport_signature");

  const claims = PassportClaimsSchema.parse(
    JSON.parse(new TextDecoder().decode(base64urlDecode(pB64))),
  );
  if (claims.aud !== opts.audience) throw new Error("passport_audience");
  const nowSec = Math.floor(opts.now / 1000);
  if (claims.exp <= nowSec) throw new Error("passport_expired");
  if (await opts.isRevoked(claims.jti)) throw new Error("passport_revoked");
  return claims;
}

export function passportRefId(): string {
  return newId("psp");
}

export function publicKeyFromJwk(jwk: Record<string, unknown>): KeyObject {
  return createPublicKey({ key: jwk as object as never, format: "jwk" });
}
