// Review fraud detection per spec §8a.2.
// Action ladder:
//   low (< 25)        → keep + display
//   medium (25..49)   → display but exclude from rating average
//   high (≥ 50)       → suppress + notify reviewer
//   confirmed         → seller penalty (rating reset, payouts on hold), reviewer ban

export type ReviewModerationStatus = "visible" | "excluded_from_avg" | "suppressed";

export interface CoordinationSignals {
  /** N reviews in same window from accounts sharing IP block / payment graph / device fingerprint. */
  burstCount: number;
  burstThreshold: number;
  /** Cosine similarity to nearest cluster centroid; ≥ 0.92 → near-duplicate. */
  linguisticSimilarity?: number;
  /** Reviewer's history concentrated on a single brand/seller (bps; 10000 = 100%). */
  brandConcentrationBps?: number;
  /** Detected incentive disclosure / refund-for-review side-channel signal. */
  incentiveDetected: boolean;
  /** Wash-trading: same principal owns both sides. */
  selfReview: boolean;
  /** Verified-purchase gate: review tied to settled order on this listing. */
  verifiedPurchase: boolean;
  /** Honeypot canary echoed in agent action — strong proof of injection. */
  honeypotEcho: boolean;
}

export interface ReviewModerationDecision {
  status: ReviewModerationStatus;
  suspicionScore: number;
  reasons: string[];
  notifyReviewer: boolean;
  sellerPenalty: boolean;
}

export function moderateReview(s: CoordinationSignals): ReviewModerationDecision {
  const reasons: string[] = [];
  let score = 0;

  if (!s.verifiedPurchase) {
    score += 20;
    reasons.push("not_verified_purchase");
  }
  if (s.selfReview) {
    score += 100;
    reasons.push("self_review");
  }
  if (s.honeypotEcho) {
    score += 100;
    reasons.push("honeypot_echo");
  }
  if (s.incentiveDetected) {
    score += 50;
    reasons.push("incentive_disclosure");
  }
  if (s.burstCount > s.burstThreshold) {
    score += 30;
    reasons.push("burst_detection");
  }
  if (s.linguisticSimilarity !== undefined && s.linguisticSimilarity >= 0.92) {
    score += 25;
    reasons.push("linguistic_cluster");
  }
  if (s.brandConcentrationBps !== undefined && s.brandConcentrationBps >= 8000) {
    score += 15;
    reasons.push("reviewer_history_brand_concentration");
  }

  let status: ReviewModerationStatus = "visible";
  if (score >= 50) status = "suppressed";
  else if (score >= 25) status = "excluded_from_avg";

  return {
    status,
    suspicionScore: Math.min(score, 100),
    reasons,
    notifyReviewer: status === "suppressed",
    sellerPenalty: s.incentiveDetected || s.selfReview,
  };
}
