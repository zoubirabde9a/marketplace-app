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
  // Inclusive at the threshold: if burstThreshold=5, a 5th coordinated review
  // IS the burst. Previously the check was `>` and the 5th review slipped past
  // — a fraud ring sizing their drops to exactly the threshold would never
  // trip the signal.
  //
  // For each numeric signal: treat a non-finite value (NaN / Infinity from a
  // broken upstream signal-pipeline) as SUSPICIOUS rather than letting the
  // comparison silently evaluate `false` and skip the contribution. A
  // moderation pipeline that quietly stops detecting fraud because the
  // burst-counter aggregator NaN'd out is exactly the failure mode this
  // module exists to prevent. Same NaN-bypass family as velocity / dispute
  // SLA / restricted-items windows. The `_signal_invalid` reasons surface
  // the upstream breakage in the audit trail so operators see it.
  if (!Number.isFinite(s.burstCount) || !Number.isFinite(s.burstThreshold)) {
    score += 30;
    reasons.push("burst_signal_invalid");
  } else if (s.burstCount >= s.burstThreshold) {
    score += 30;
    reasons.push("burst_detection");
  }
  if (s.linguisticSimilarity !== undefined) {
    if (!Number.isFinite(s.linguisticSimilarity)) {
      score += 25;
      reasons.push("linguistic_signal_invalid");
    } else if (s.linguisticSimilarity >= 0.92) {
      score += 25;
      reasons.push("linguistic_cluster");
    }
  }
  if (s.brandConcentrationBps !== undefined) {
    if (!Number.isFinite(s.brandConcentrationBps)) {
      score += 15;
      reasons.push("brand_concentration_signal_invalid");
    } else if (s.brandConcentrationBps >= 8000) {
      score += 15;
      reasons.push("reviewer_history_brand_concentration");
    }
  }

  let status: ReviewModerationStatus = "visible";
  if (score >= 50) status = "suppressed";
  else if (score >= 25) status = "excluded_from_avg";

  // Notifying the reviewer that their review was suppressed normally lets a
  // legitimately-flagged user appeal. But for self-reviews (the reviewer IS
  // the colluder) and honeypot echoes (proof of prompt-injection / scripted
  // poster), the "reviewer" is the bad actor — telling them which signal
  // tripped the moderator just teaches them how to evade it next time.
  // Suppress silently in those cases.
  const silentFraudSignal = s.selfReview || s.honeypotEcho;
  return {
    status,
    suspicionScore: Math.min(score, 100),
    reasons,
    notifyReviewer: status === "suppressed" && !silentFraudSignal,
    sellerPenalty: s.incentiveDetected || s.selfReview,
  };
}
