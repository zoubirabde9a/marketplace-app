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
  if (
    signals.priceVsAuthorizedFloorBps !== undefined &&
    signals.priceVsAuthorizedFloorBps < 6500
  ) {
    score += W.priceAnomaly;
    contributors.push({ name: "price_anomaly_below_floor", weight: W.priceAnomaly });
  }
  if (
    signals.sellerAgeDays < 90 &&
    (signals.sellerReputationBps ?? 0) < 5000
  ) {
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
