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
  // Number.isInteger rejects NaN/Infinity/non-integers — without this gate,
  // `NaN <= 0` and `NaN >= band.minQty` both evaluate to `false`, slipping
  // past the qty bounds AND the band selector (find() returns undefined →
  // 0% discount applied → request rejected as discount_exceeds_allowed_band,
  // exposing the rejection path on garbage input instead of failing loud).
  // Same Number.isInteger defense applied to cart qty (pass #132).
  if (!Number.isInteger(req.qty)) throw new ConflictError("negotiation_qty_invalid");
  if (req.qty <= 0) throw new ConflictError("negotiation_qty_invalid");
  if (req.proposedUnitPriceMinor <= 0n) throw new ConflictError("negotiation_price_invalid");
  // BigInt division throws on a 0 divisor. The schema gate requires
  // positive listPrice (a2a/negotiate.ts pass #103) but direct domain
  // callers (tests, internal sagas, future REST surfaces) bypass — and a
  // 0 list price would otherwise crash at line `((listPrice -
  // proposed) * 10000n) / listPriceMinor` with a raw RangeError instead of
  // a typed ConflictError.
  if (policy.listPriceMinor <= 0n) {
    throw new ConflictError("negotiation_list_price_must_be_positive");
  }
  if (policy.floorPriceMinor <= 0n) {
    throw new ConflictError("negotiation_floor_price_must_be_positive");
  }
  // Fail-closed on Invalid Date for the request timestamp. Pre-fix
  // `req.now >= policy.promo.startsAt` and `req.now <= endsAt` both
  // evaluated `false` (NaN coercion), silently dropping the promo's
  // extra-discount band — a buyer requesting during a promo window with
  // a corrupted `now` would get the worse non-promo counter. Treat
  // invalid timestamps as a hard error so the caller surfaces the bug.
  if (!Number.isFinite(req.now.getTime())) {
    throw new ConflictError("negotiation_now_invalid");
  }

  if (policy.forbiddenSegments) {
    for (const seg of req.buyerSegments) {
      if (policy.forbiddenSegments.includes(seg)) {
        throw new ForbiddenError(`negotiation_segment_blocked:${seg}`);
      }
    }
  }

  // Below floor → server-side hard reject (spec §7b). The seller's
  // `floorPriceMinor` is PRIVATE per the policy interface — DO NOT return
  // it as a counter-offer (which the previous code did literally:
  // `counterUnitPriceMinor: policy.floorPriceMinor`). A buyer submitting
  // a token-low offer would otherwise learn the seller's true floor on
  // the first try, defeating the §7b privacy guarantee. Omit the counter
  // entirely; the buyer can iterate upward to discover the band-allowed
  // minimum (which does NOT reveal the floor directly).
  if (req.proposedUnitPriceMinor < policy.floorPriceMinor) {
    return {
      accepted: false,
      reason: "below_floor_price",
      effectiveDiscountBps: 0,
    };
  }

  const allowedDiscountBps = computeAllowedDiscountBps(policy, req);
  const minAllowedPrice =
    policy.listPriceMinor - (policy.listPriceMinor * BigInt(allowedDiscountBps)) / 10000n;

  if (req.proposedUnitPriceMinor >= minAllowedPrice && req.proposedUnitPriceMinor >= policy.floorPriceMinor) {
    const effectiveDiscount = Number(
      ((policy.listPriceMinor - req.proposedUnitPriceMinor) * 10000n) / policy.listPriceMinor,
    );
    return {
      accepted: true,
      reason: "within_allowed_discount_band",
      effectiveDiscountBps: Math.max(0, effectiveDiscount),
    };
  }

  // Return the band-derived minimum (qty/promo-dependent) as the counter,
  // NOT the floor-clamped value. If `minAllowedPrice < floorPriceMinor`,
  // the buyer re-submitting at that counter will hit the below-floor
  // path above and get rejected without a counter — they can iterate,
  // but at no point does the response contain the floor verbatim.
  return {
    accepted: false,
    counterUnitPriceMinor: minAllowedPrice,
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
  // Negotiation payloads carry prices and quantities — typed as bigint in
  // the domain layer. Plain JSON.stringify throws `TypeError: Do not know
  // how to serialize a BigInt` on the first price-bearing exchange, and
  // every consumer of transcriptHash (audit storage, dispute evidence,
  // signed receipts) silently fails. Use the same bigint-aware replacer
  // as the MCP transport / Redis snapshot store: emit bigints as JSON
  // strings, lossless and replay-safe.
  const replacer = (_key: string, value: unknown): unknown =>
    typeof value === "bigint" ? value.toString() : value;
  const canonical = JSON.stringify(
    {
      dialogue_id: t.dialogueId,
      buyer: t.buyerAgentId,
      seller: t.sellerAgentId,
      variant: t.variantId,
      // Reject Invalid Date in any exchange timestamp BEFORE map runs —
    // `e.at.toISOString()` throws a raw `RangeError` on Invalid Date
    // out of the function, with no actionable context for the caller.
    // The transcriptHash is signed and stored as dispute evidence;
    // refusing to hash a transcript with a corrupt timestamp is the
    // right call (better than hashing the well-formed exchanges and
    // skipping the broken one — that would silently change the
    // hash from the buyer's record vs the seller's record).
    exchanges: t.exchanges.map((e) => {
      const atMs = e.at.getTime();
      if (!Number.isFinite(atMs)) {
        throw new RangeError(`transcriptHash:invalid_exchange_at`);
      }
      return { at: e.at.toISOString(), s: e.speaker, p: e.payload };
    }),
    },
    replacer,
  );
  return createHash("sha256").update(canonical).digest("hex");
}
