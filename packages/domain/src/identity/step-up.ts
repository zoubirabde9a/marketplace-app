// Step-up authorization tier evaluation per spec §3.7.
// Mapping (cart total, merchant novelty, cross-border, velocity) → required tier.

import { StepUpRequiredError } from "@marketplace/shared/errors";

export type StepUpTier = 0 | 1 | 2 | 3 | 4 | 5;

export interface StepUpInputs {
  /** Charge amount in minor units (cents). */
  amountMinor: bigint;
  /** Currency ISO code (USD-equivalent thresholds use FX conversion before calling). */
  currencyIsUsdEquivalent: boolean;
  /** Has the principal transacted with this merchant before? */
  isNewMerchant: boolean;
  /** Buyer & ship-to in different jurisdictions? */
  isCrossBorder: boolean;
  /** True if this is a high-risk category (firearms, alcohol, gift cards above threshold, etc.). */
  isHighRiskCategory: boolean;
  /** Velocity anomaly already detected upstream. */
  velocityAnomaly: boolean;
  /** Whether this is an account-level mutation (payout target, scopes, caps). */
  isAccountMutation: boolean;
  /** Whether the request is read-only (catalog.search, etc.). */
  isReadOnly: boolean;
  /** Whether the request is a low-impact cart mutation. */
  isCartMutationOnly: boolean;
  /** Daily spend cap defined on the passport in same currency-equivalent. */
  dailyCapMinor: bigint;
  /** Already spent today against the cap. */
  dailySpentMinor: bigint;
}

export interface StepUpProof {
  /** Highest tier the principal currently satisfies for this request. */
  satisfiedTier: StepUpTier;
  /** UNIX-ms timestamp the proof was issued. Used to bound freshness for tier 4+. */
  issuedAtMs: number;
}

export const TIER_REASON = {
  0: "read_only",
  1: "cart_mutation",
  2: "checkout_within_intent_mandate",
  3: "checkout_requires_closed_cart_mandate",
  4: "checkout_requires_live_passkey",
  5: "account_level_mutation",
} as const;

const TIER_2_USD_CEILING = 250_00n;
const TIER_4_USD_CEILING = 5_000_00n;
const TIER_4_MAX_AGE_MS = 60_000;
const TIER_3_MAX_AGE_MS = 5 * 60_000;

export function requiredStepUp(input: StepUpInputs): { tier: StepUpTier; reason: string } {
  if (input.isAccountMutation) return { tier: 5, reason: TIER_REASON[5] };
  if (input.isReadOnly) return { tier: 0, reason: TIER_REASON[0] };
  if (input.isCartMutationOnly) return { tier: 1, reason: TIER_REASON[1] };

  let tier: StepUpTier = 2;
  let reason: string = TIER_REASON[2];

  // Tier-3 triggers
  if (
    (input.currencyIsUsdEquivalent && input.amountMinor > TIER_2_USD_CEILING) ||
    input.isNewMerchant ||
    input.isCrossBorder ||
    input.dailySpentMinor + input.amountMinor > input.dailyCapMinor
  ) {
    tier = 3;
    reason = TIER_REASON[3];
  }

  // Tier-4 triggers
  if (
    (input.currencyIsUsdEquivalent && input.amountMinor > TIER_4_USD_CEILING) ||
    input.isHighRiskCategory ||
    input.velocityAnomaly
  ) {
    tier = 4;
    reason = TIER_REASON[4];
  }

  return { tier, reason };
}

export function enforceStepUp(input: StepUpInputs, proof: StepUpProof | undefined, now: number): void {
  const required = requiredStepUp(input);
  if (required.tier === 0) return;
  if (!proof || proof.satisfiedTier < required.tier) {
    throw new StepUpRequiredError(required.tier, required.reason);
  }
  if (required.tier >= 4 && now - proof.issuedAtMs > TIER_4_MAX_AGE_MS) {
    throw new StepUpRequiredError(required.tier, "tier_4_proof_stale");
  }
  if (required.tier === 3 && now - proof.issuedAtMs > TIER_3_MAX_AGE_MS) {
    throw new StepUpRequiredError(required.tier, "tier_3_proof_stale");
  }
}
