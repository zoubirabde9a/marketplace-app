// A2A negotiated-pricing guardrails per spec §7b.
//
// Allowed: quantity discounts within seller-declared bands, time-limited offers within
// seller's min margin floor, bundle pricing.
// Disallowed (server-enforced):
//   - Cross-buyer discrimination on protected attributes (jurisdiction-checked).
//   - Discount below `floor_price`.
//   - Buyer↔buyer coordination on offers (collusion).

import { createHash } from "node:crypto";
import { ConflictError, ForbiddenError } from "@marketplace/shared/errors";

export interface QuantityBand {
  minQty: number;
  maxQty?: number;
  discountBps: number; // 0-10000 of unit price
}

export interface SellerOfferPolicy {
  sellerOrgId: string;
  variantId: string;
  /** PRIVATE — never returned to buyers. */
  floorPriceMinor: bigint;
  listPriceMinor: bigint;
  currency: string;
  quantityBands: QuantityBand[];
  /** Optional time-limited promo allowing extra discount within window. */
  promo?: { extraDiscountBps: number; startsAt: Date; endsAt: Date };
  /** Buyer-segment restrictions (jurisdiction prohibits some). */
  forbiddenSegments?: string[];
}

export interface NegotiationRequest {
  buyerAgentId: string;
  buyerOrgId?: string;
  buyerJurisdiction?: string;
  buyerSegments: string[];
  qty: number;
  proposedUnitPriceMinor: bigint;
  bundleVariantIds?: string[];
  now: Date;
}

export interface NegotiationDecision {
  accepted: boolean;
  /** Counter-offer the seller could honor; null if no counter possible. */
  counterUnitPriceMinor?: bigint;
  reason: string;
  effectiveDiscountBps: number;
}

export function evaluateNegotiation(
  policy: SellerOfferPolicy,
  req: NegotiationRequest,
): NegotiationDecision {
  if (req.qty <= 0) throw new ConflictError("negotiation_qty_invalid");
  if (req.proposedUnitPriceMinor <= 0n) throw new ConflictError("negotiation_price_invalid");

  if (policy.forbiddenSegments) {
    for (const seg of req.buyerSegments) {
      if (policy.forbiddenSegments.includes(seg)) {
        throw new ForbiddenError(`negotiation_segment_blocked:${seg}`);
      }
    }
  }

  // Below floor → server-side hard reject (spec §7b)
  if (req.proposedUnitPriceMinor < policy.floorPriceMinor) {
    return {
      accepted: false,
      counterUnitPriceMinor: policy.floorPriceMinor,
      reason: "below_floor_price",
      effectiveDiscountBps: 0,
    };
  }

  const allowedDiscountBps = computeAllowedDiscountBps(policy, req);
  const minAllowedPrice =
    policy.listPriceMinor - (policy.listPriceMinor * BigInt(allowedDiscountBps)) / 10000n;
  const minAllowedClamped = minAllowedPrice < policy.floorPriceMinor ? policy.floorPriceMinor : minAllowedPrice;

  if (req.proposedUnitPriceMinor >= minAllowedClamped) {
    const effectiveDiscount = Number(
      ((policy.listPriceMinor - req.proposedUnitPriceMinor) * 10000n) / policy.listPriceMinor,
    );
    return {
      accepted: true,
      reason: "within_allowed_discount_band",
      effectiveDiscountBps: Math.max(0, effectiveDiscount),
    };
  }

  return {
    accepted: false,
    counterUnitPriceMinor: minAllowedClamped,
    reason: "discount_exceeds_allowed_band",
    effectiveDiscountBps: 0,
  };
}

function computeAllowedDiscountBps(policy: SellerOfferPolicy, req: NegotiationRequest): number {
  const band = [...policy.quantityBands]
    .sort((a, b) => b.minQty - a.minQty)
    .find((b) => req.qty >= b.minQty && (b.maxQty === undefined || req.qty <= b.maxQty));
  let bps = band?.discountBps ?? 0;
  if (
    policy.promo &&
    req.now >= policy.promo.startsAt &&
    req.now <= policy.promo.endsAt
  ) {
    bps += policy.promo.extraDiscountBps;
  }
  return Math.min(bps, 10000);
}

export interface NegotiationTranscript {
  dialogueId: string;
  buyerAgentId: string;
  sellerAgentId: string;
  variantId: string;
  exchanges: Array<{ at: Date; speaker: "buyer" | "seller"; payload: unknown }>;
}

export function transcriptHash(t: NegotiationTranscript): string {
  const canonical = JSON.stringify({
    dialogue_id: t.dialogueId,
    buyer: t.buyerAgentId,
    seller: t.sellerAgentId,
    variant: t.variantId,
    exchanges: t.exchanges.map((e) => ({ at: e.at.toISOString(), s: e.speaker, p: e.payload })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
