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
