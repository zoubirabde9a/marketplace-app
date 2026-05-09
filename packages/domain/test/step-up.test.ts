import { describe, expect, it } from "vitest";
import { enforceStepUp, requiredStepUp } from "../src/identity/step-up.js";
import { StepUpRequiredError } from "@marketplace/shared/errors";

const base = {
  amountMinor: 50_00n,
  currencyIsUsdEquivalent: true,
  isNewMerchant: false,
  isCrossBorder: false,
  isHighRiskCategory: false,
  velocityAnomaly: false,
  isAccountMutation: false,
  isReadOnly: false,
  isCartMutationOnly: false,
  dailyCapMinor: 1_000_00n,
  dailySpentMinor: 0n,
};

describe("requiredStepUp", () => {
  it("read-only is tier 0", () => {
    expect(requiredStepUp({ ...base, isReadOnly: true }).tier).toBe(0);
  });

  it("cart mutation is tier 1", () => {
    expect(requiredStepUp({ ...base, isCartMutationOnly: true }).tier).toBe(1);
  });

  it("normal small checkout is tier 2", () => {
    expect(requiredStepUp(base).tier).toBe(2);
  });

  it("over $250 escalates to tier 3", () => {
    expect(requiredStepUp({ ...base, amountMinor: 300_00n }).tier).toBe(3);
  });

  it("new merchant escalates to tier 3", () => {
    expect(requiredStepUp({ ...base, isNewMerchant: true }).tier).toBe(3);
  });

  it("over $5000 escalates to tier 4", () => {
    expect(requiredStepUp({ ...base, amountMinor: 6_000_00n }).tier).toBe(4);
  });

  it("velocity anomaly escalates to tier 4", () => {
    expect(requiredStepUp({ ...base, velocityAnomaly: true }).tier).toBe(4);
  });

  it("account mutation always tier 5", () => {
    expect(requiredStepUp({ ...base, isAccountMutation: true }).tier).toBe(5);
  });
});

describe("enforceStepUp", () => {
  const now = 1_700_000_000_000;
  it("passes when proof tier ≥ required", () => {
    expect(() =>
      enforceStepUp(base, { satisfiedTier: 3, issuedAtMs: now - 1000 }, now),
    ).not.toThrow();
  });

  it("rejects when proof tier < required", () => {
    expect(() =>
      enforceStepUp({ ...base, amountMinor: 6_000_00n }, { satisfiedTier: 2, issuedAtMs: now }, now),
    ).toThrow(StepUpRequiredError);
  });

  it("rejects stale tier-4 proof (> 60s)", () => {
    expect(() =>
      enforceStepUp(
        { ...base, amountMinor: 6_000_00n },
        { satisfiedTier: 4, issuedAtMs: now - 70_000 },
        now,
      ),
    ).toThrow(/tier_4_proof_stale/);
  });

  it("rejects stale tier-3 proof (> 5min)", () => {
    expect(() =>
      enforceStepUp(
        { ...base, isNewMerchant: true },
        { satisfiedTier: 3, issuedAtMs: now - 6 * 60_000 },
        now,
      ),
    ).toThrow(/tier_3_proof_stale/);
  });
});
