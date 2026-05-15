import { describe, expect, it } from "vitest";
import { counterfeitActions, scoreCounterfeit } from "../src/catalog/counterfeit.js";

describe("scoreCounterfeit", () => {
  it("low risk for clean signals", () => {
    const r = scoreCounterfeit({
      brandRegistryMismatch: false,
      sellerAgeDays: 365,
      imageHashHits: 0,
      descriptionAnomalies: 0,
    });
    expect(r.risk).toBe("low");
  });

  it("elevated risk for new low-rep seller + price anomaly", () => {
    const r = scoreCounterfeit({
      brandRegistryMismatch: false,
      sellerAgeDays: 30,
      sellerReputationBps: 1000,
      priceVsAuthorizedFloorBps: 5000, // 50% of authorized floor
      imageHashHits: 0,
      descriptionAnomalies: 0,
    });
    expect(r.risk).toBe("elevated");
  });

  it("flags elevated dispute rate (>2%) — was previously declared but unused", () => {
    const r = scoreCounterfeit({
      brandRegistryMismatch: false,
      sellerAgeDays: 365,
      imageHashHits: 0,
      descriptionAnomalies: 0,
      disputeRateBps: 350, // 3.5% — well above 2% absolute cutoff
    });
    expect(r.contributors.map((c) => c.name)).toContain("elevated_dispute_rate");
  });

  it("does NOT flag dispute rate at or under the 200bps cutoff", () => {
    const r = scoreCounterfeit({
      brandRegistryMismatch: false,
      sellerAgeDays: 365,
      imageHashHits: 0,
      descriptionAnomalies: 0,
      disputeRateBps: 150, // 1.5% — under the 2% cutoff
    });
    expect(r.contributors.map((c) => c.name)).not.toContain("elevated_dispute_rate");
  });

  it("high risk for brand mismatch + image hash hit", () => {
    const r = scoreCounterfeit({
      brandRegistryMismatch: true,
      sellerAgeDays: 365,
      imageHashHits: 1,
      descriptionAnomalies: 0,
    });
    expect(r.risk).toBe("high");
  });
});

describe("counterfeitActions", () => {
  it("low keeps everything visible", () => {
    expect(counterfeitActions("low")).toEqual({
      visible: true,
      derank: false,
      payoutHeld: false,
      requireSupplyChainDoc: false,
    });
  });

  it("high suppresses listing and adds 48h SLA", () => {
    const a = counterfeitActions("high");
    expect(a.visible).toBe(false);
    expect(a.reviewSlaHours).toBe(48);
  });
});
