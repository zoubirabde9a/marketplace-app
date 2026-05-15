// Counterfeit risk scoring per spec §8.3.

import type { CounterfeitRiskT } from "./types.js";

export interface CounterfeitSignals {
  /** Listed brand not on this seller's authorized list (or no Brand Registry entry). */
  brandRegistryMismatch: boolean;
  /** Listing price in same currency vs. brand-authorized floor on this GTIN, in basis points (10000 = 100%). */
  priceVsAuthorizedFloorBps?: number;
  /** Days since seller account creation. */
  sellerAgeDays: number;
  /** Reputation score in basis points (0–10000). */
  sellerReputationBps?: number;
  /** Image perceptual-hash hits on known counterfeit corpus. */
  imageHashHits: number;
  /** Wrong-region language, missing/malformed serial format, brand misspelled. */
  descriptionAnomalies: number;
  /** Buyer-side rolling refund rate for this seller (bps). */
  refundRateBps?: number;
  /** Buyer-side rolling dispute rate for this seller (bps). */
  disputeRateBps?: number;
  /** Brand category baseline refund rate for comparison (bps). */
  categoryBaselineRefundBps?: number;
}

export interface RiskScore {
  risk: CounterfeitRiskT;
  score: number;
  contributors: Array<{ name: string; weight: number }>;
}

const W = {
  brandRegistryMismatch: 35,
  priceAnomaly: 25,
  newSellerHighRiskSku: 15,
  imageHashHit: 30,
  descriptionAnomaly: 8,
  buyerSideAnomaly: 12,
};

export function scoreCounterfeit(signals: CounterfeitSignals): RiskScore {
  const contributors: Array<{ name: string; weight: number }> = [];
  let score = 0;

  if (signals.brandRegistryMismatch) {
    score += W.brandRegistryMismatch;
    contributors.push({ name: "brand_registry_mismatch", weight: W.brandRegistryMismatch });
  }
  // For every numeric signal: treat a non-finite value (NaN / Infinity from
  // a broken upstream signal pipeline) as flag-worthy rather than letting
  // the comparison silently evaluate `false` and skip the contribution.
  // Same NaN-bypass family as moderation (pass #130). A scoring pipeline
  // that quietly stops detecting counterfeits because the price-feed
  // aggregator NaN'd out is exactly what this module exists to prevent.
  if (signals.priceVsAuthorizedFloorBps !== undefined) {
    if (!Number.isFinite(signals.priceVsAuthorizedFloorBps)) {
      score += W.priceAnomaly;
      contributors.push({ name: "price_signal_invalid", weight: W.priceAnomaly });
    } else if (signals.priceVsAuthorizedFloorBps < 6500) {
      score += W.priceAnomaly;
      contributors.push({ name: "price_anomaly_below_floor", weight: W.priceAnomaly });
    }
  }
  // `?? 0` does NOT catch NaN — `NaN ?? 0` keeps NaN — so a NaN reputation
  // makes `NaN < 5000` evaluate `false` and treats a new seller as if they
  // already had high reputation. Force NaN → 0 via Number.isFinite so the
  // new-seller-low-rep flag fires when reputation is unmeasurable.
  const repBps = signals.sellerReputationBps !== undefined && Number.isFinite(signals.sellerReputationBps)
    ? signals.sellerReputationBps
    : 0;
  const sellerAgeOk = Number.isFinite(signals.sellerAgeDays) && signals.sellerAgeDays >= 0;
  const effectiveSellerAge = sellerAgeOk ? signals.sellerAgeDays : 0;
  if (effectiveSellerAge < 90 && repBps < 5000) {
    score += W.newSellerHighRiskSku;
    contributors.push({ name: "new_low_reputation_seller", weight: W.newSellerHighRiskSku });
  }
  if (signals.imageHashHits > 0) {
    score += W.imageHashHit;
    contributors.push({ name: "image_hash_hit", weight: W.imageHashHit });
  }
  if (signals.descriptionAnomalies > 0) {
    const w = Math.min(signals.descriptionAnomalies, 3) * (W.descriptionAnomaly / 3);
    score += w;
    contributors.push({ name: "description_anomalies", weight: w });
  }
  if (
    signals.refundRateBps !== undefined &&
    signals.categoryBaselineRefundBps !== undefined &&
    signals.refundRateBps > signals.categoryBaselineRefundBps * 1.5
  ) {
    score += W.buyerSideAnomaly;
    contributors.push({ name: "elevated_refund_rate", weight: W.buyerSideAnomaly });
  }
  // Dispute-rate signal: declared on the input but previously never read — a
  // seller could fly under the radar by absorbing buyer refunds privately
  // while quietly accruing disputes, and counterfeit scoring would see none
  // of it. Without a category baseline we use an absolute 200 bps (2%) cutoff;
  // typical authorised-brand baselines are <50 bps, so 2% is a clear outlier.
  if (signals.disputeRateBps !== undefined && signals.disputeRateBps > 200) {
    score += W.buyerSideAnomaly;
    contributors.push({ name: "elevated_dispute_rate", weight: W.buyerSideAnomaly });
  }

  let risk: CounterfeitRiskT = "low";
  if (score >= 50) risk = "high";
  else if (score >= 25) risk = "elevated";

  return { risk, score, contributors };
}

export function counterfeitActions(risk: CounterfeitRiskT): {
  visible: boolean;
  derank: boolean;
  payoutHeld: boolean;
  requireSupplyChainDoc: boolean;
  reviewSlaHours?: number;
} {
  switch (risk) {
    case "low":
      return { visible: true, derank: false, payoutHeld: false, requireSupplyChainDoc: false };
    case "elevated":
      return {
        visible: true,
        derank: true,
        payoutHeld: true,
        requireSupplyChainDoc: true,
      };
    case "high":
      return {
        visible: false,
        derank: true,
        payoutHeld: true,
        requireSupplyChainDoc: true,
        reviewSlaHours: 48,
      };
  }
}
