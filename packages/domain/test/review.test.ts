import { describe, expect, it } from "vitest";
import { moderateReview } from "../src/review/moderation.js";
import { selectEligibleOrderItem } from "../src/review/eligibility.js";

const cleanSignals = {
  burstCount: 0,
  burstThreshold: 5,
  incentiveDetected: false,
  selfReview: false,
  verifiedPurchase: true,
  honeypotEcho: false,
};

describe("moderateReview", () => {
  it("keeps clean verified review visible", () => {
    expect(moderateReview(cleanSignals).status).toBe("visible");
  });

  it("excludes from average when not verified", () => {
    expect(moderateReview({ ...cleanSignals, verifiedPurchase: false }).status).toBe("visible");
  });

  it("suppresses self-reviews", () => {
    const r = moderateReview({ ...cleanSignals, selfReview: true });
    expect(r.status).toBe("suppressed");
    expect(r.sellerPenalty).toBe(true);
  });

  it("suppresses incentive disclosures and triggers seller penalty", () => {
    const r = moderateReview({ ...cleanSignals, incentiveDetected: true });
    expect(r.status).toBe("suppressed");
    expect(r.sellerPenalty).toBe(true);
  });

  it("near-duplicate cluster + burst → suppressed", () => {
    const r = moderateReview({
      ...cleanSignals,
      burstCount: 50,
      linguisticSimilarity: 0.95,
    });
    expect(r.status).toBe("suppressed");
    expect(r.reasons).toContain("burst_detection");
    expect(r.reasons).toContain("linguistic_cluster");
  });

  it("honeypot canary echo always suppresses", () => {
    const r = moderateReview({ ...cleanSignals, honeypotEcho: true });
    expect(r.status).toBe("suppressed");
  });
});

describe("selectEligibleOrderItem", () => {
  const now = new Date("2026-05-03");

  it("rejects when no settled order item", () => {
    expect(() =>
      selectEligibleOrderItem({
        reviewerUserId: "u1",
        productId: "p1",
        reviewerSettledItems: [],
        reviewWindowDays: 90,
        now,
        existingReviewsOnItem: 0,
      }),
    ).toThrow(/no_settled_purchase/);
  });

  it("accepts via canonical product id", () => {
    const r = selectEligibleOrderItem({
      reviewerUserId: "u1",
      productId: "p1",
      canonicalProductId: "c1",
      reviewerSettledItems: [
        { productId: "p2", canonicalProductId: "c1", orderItemId: "oi1", settledAt: new Date("2026-04-01") },
      ],
      reviewWindowDays: 90,
      now,
      existingReviewsOnItem: 0,
    });
    expect(r.orderItemId).toBe("oi1");
  });

  it("rejects past review window", () => {
    expect(() =>
      selectEligibleOrderItem({
        reviewerUserId: "u1",
        productId: "p1",
        reviewerSettledItems: [
          { productId: "p1", orderItemId: "oi1", settledAt: new Date("2025-01-01") },
        ],
        reviewWindowDays: 90,
        now,
        existingReviewsOnItem: 0,
      }),
    ).toThrow(/no_settled_purchase/);
  });

  it("blocks duplicate review on same order item", () => {
    expect(() =>
      selectEligibleOrderItem({
        reviewerUserId: "u1",
        productId: "p1",
        reviewerSettledItems: [
          { productId: "p1", orderItemId: "oi1", settledAt: new Date("2026-04-01") },
        ],
        reviewWindowDays: 90,
        now,
        existingReviewsOnItem: 1,
      }),
    ).toThrow(/already_exists/);
  });
});
