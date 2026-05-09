// AP2 mandate verification per spec §3.4 / §7.1.
//
// Three mandate kinds:
//   intent           — agent may buy ≤ $X of {category} from {merchants} before {deadline}
//   cart             — this exact cart is approved
//   payment          — cryptographic auth for a specific tx amount on a specific instrument
//   recurring_intent — parent for subscriptions; spawns per-cycle cart+payment mandates
//
// VDC envelope (simplified): { claims, signature, signer_jwk, content_hash }.

import { z } from "zod";
import { sign, verify, createHash, type KeyObject } from "node:crypto";
import { MandateError } from "@marketplace/shared/errors";
import { base64url, base64urlDecode } from "../identity/dpop.js";

export const MandateKind = z.enum(["intent", "cart", "payment", "recurring_intent"]);
export type MandateKindT = z.infer<typeof MandateKind>;

export const MandateConstraintsSchema = z.object({
  merchants: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  skus: z.array(z.string()).optional(),
  jurisdictions: z.array(z.string().length(2)).optional(),
  maxItems: z.number().int().positive().optional(),
});
export type MandateConstraints = z.infer<typeof MandateConstraintsSchema>;

export const MandateRecurrenceSchema = z.object({
  interval: z.enum(["day", "week", "month", "year"]),
  intervalCount: z.number().int().positive(),
  maxPerPeriodMinor: z.string(), // BigInt as string in JSON
  endAfter: z.number().int().positive().optional(),
  totalCapMinor: z.string().optional(),
  delegateTo: z.string().optional(),
});
export type MandateRecurrence = z.infer<typeof MandateRecurrenceSchema>;

export const MandateClaimsSchema = z.object({
  kind: MandateKind,
  iss: z.string(), // marketplace or principal id
  sub: z.string(), // agent id
  aud: z.string(), // marketplace audience
  jti: z.string(), // mandate id
  iat: z.number(),
  nbf: z.number().optional(),
  exp: z.number(),
  parent: z.string().optional(), // parent mandate id (per-cycle children of recurring)
  step_up_tier: z.number().int().min(0).max(5),
  step_up_proof_at: z.number().optional(), // unix ms; required for tier ≥ 4
  cap: z.object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount_minor: z.string(),
  }),
  constraints: MandateConstraintsSchema.optional(),
  recurrence: MandateRecurrenceSchema.optional(),
  cart_hash: z.string().optional(), // for cart mandates: SHA-256 of canonical cart
  payment_method_handle: z.string().optional(), // for payment mandates
  signing_jwk: z.record(z.string(), z.unknown()),
});
export type MandateClaims = z.infer<typeof MandateClaimsSchema>;

export interface MandateVerifyOptions {
  audience: string;
  now: number; // unix ms
  resolveSignerKey: (claims: MandateClaims) => Promise<KeyObject | undefined>;
  isRevoked: (mandateId: string) => Promise<boolean>;
}

export interface VerifiedMandate {
  claims: MandateClaims;
  contentHash: string;
}

export async function verifyMandate(
  vdcJwt: string,
  opts: MandateVerifyOptions,
): Promise<VerifiedMandate> {
  const parts = vdcJwt.split(".");
  if (parts.length !== 3) throw new MandateError("malformed", "mandate_malformed");
  const [hB64, pB64, sB64] = parts as [string, string, string];

  const header = JSON.parse(new TextDecoder().decode(base64urlDecode(hB64))) as Record<string, unknown>;
  if (header["typ"] !== "ap2-vdc+jwt") throw new MandateError("typ", "mandate_typ");
  if (header["alg"] !== "EdDSA") throw new MandateError("alg", "mandate_alg");

  const claims = MandateClaimsSchema.parse(
    JSON.parse(new TextDecoder().decode(base64urlDecode(pB64))),
  );

  if (claims.aud !== opts.audience) {
    throw new MandateError("audience", "mandate_audience_mismatch");
  }
  const nowSec = Math.floor(opts.now / 1000);
  if (claims.exp <= nowSec) throw new MandateError("expired", "mandate_expired");
  if (claims.nbf !== undefined && claims.nbf > nowSec) {
    throw new MandateError("not_yet_valid", "mandate_nbf");
  }
  if (claims.step_up_tier >= 4 && !claims.step_up_proof_at) {
    throw new MandateError("step_up_proof_required", "mandate_missing_step_up_proof");
  }

  const signerKey = await opts.resolveSignerKey(claims);
  if (!signerKey) throw new MandateError("signer_unknown", "mandate_signer_unknown");

  const ok = verify(null, Buffer.from(`${hB64}.${pB64}`), signerKey, base64urlDecode(sB64));
  if (!ok) throw new MandateError("signature", "mandate_bad_signature");

  if (await opts.isRevoked(claims.jti)) {
    throw new MandateError("revoked", "mandate_revoked");
  }

  const contentHash = createHash("sha256")
    .update(Buffer.from(`${hB64}.${pB64}`))
    .digest("hex");

  return { claims, contentHash };
}

/** Sign a mandate VDC. Used in tests and for marketplace-side per-cycle Cart Mandates. */
export function signMandate(claims: MandateClaims, privateKey: KeyObject, kid: string): string {
  const header = { alg: "EdDSA", typ: "ap2-vdc+jwt", kid };
  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(claims)));
  const sig = sign(null, Buffer.from(`${headerB64}.${payloadB64}`), privateKey);
  return `${headerB64}.${payloadB64}.${base64url(sig)}`;
}

/** Canonical cart hash — must match cart mandate's `cart_hash`. */
export function canonicalCartHash(cart: {
  cartId: string;
  currency: string;
  items: ReadonlyArray<{ variantId: string; qty: number; unitPriceMinor: bigint; sellerId: string }>;
  shippingMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}): string {
  const canonical = {
    cart_id: cart.cartId,
    currency: cart.currency,
    items: [...cart.items]
      .sort((a, b) => a.variantId.localeCompare(b.variantId))
      .map((i) => ({
        variant_id: i.variantId,
        qty: i.qty,
        unit_price_minor: i.unitPriceMinor.toString(),
        seller_id: i.sellerId,
      })),
    shipping_minor: cart.shippingMinor.toString(),
    tax_minor: cart.taxMinor.toString(),
    total_minor: cart.totalMinor.toString(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
