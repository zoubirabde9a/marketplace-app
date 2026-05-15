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

  it("burst trips at the threshold itself (inclusive, not strictly greater)", () => {
    // burstThreshold = 5 → the 5th coordinated review IS the burst.
    const r = moderateReview({ ...cleanSignals, burstCount: 5, burstThreshold: 5 });
    expect(r.reasons).toContain("burst_detection");
  });

  it("burst does NOT trip below the threshold", () => {
    const r = moderateReview({ ...cleanSignals, burstCount: 4, burstThreshold: 5 });
    expect(r.reasons).not.toContain("burst_detection");
  });

  it("does NOT notify reviewer on self-review (would tip off the colluder)", () => {
    const r = moderateReview({ ...cleanSignals, selfReview: true });
    expect(r.status).toBe("suppressed");
    expect(r.notifyReviewer).toBe(false);
  });

  it("does NOT notify reviewer on honeypot echo (would teach them the evasion)", () => {
    const r = moderateReview({ ...cleanSignals, honeypotEcho: true });
    expect(r.status).toBe("suppressed");
    expect(r.notifyReviewer).toBe(false);
  });

  it("DOES notify reviewer on burst/cluster suppression (legitimate appeal path)", () => {
    const r = moderateReview({
      ...cleanSignals,
      burstCount: 50,
      linguisticSimilarity: 0.95,
    });
    expect(r.status).toBe("suppressed");
    expect(r.notifyReviewer).toBe(true);
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

  it("picks the most recent eligible purchase (not array order)", () => {
    // Buyer purchased the same product twice; the fresher experience is the
    // one we tie the review to. Previously the function picked whichever item
    // happened to be first in the array — non-deterministic for audit replay
    // and surprising when the older purchase is also still in-window.
    const r = selectEligibleOrderItem({
      reviewerUserId: "u1",
      productId: "p1",
      reviewerSettledItems: [
        { productId: "p1", orderItemId: "oi_older", settledAt: new Date("2026-03-01") },
        { productId: "p1", orderItemId: "oi_newer", settledAt: new Date("2026-04-20") },
      ],
      reviewWindowDays: 90,
      now,
      existingReviewsOnItem: 0,
    });
    expect(r.orderItemId).toBe("oi_newer");
  });

  it("rejects a 0/negative review window (misconfiguration guard)", () => {
    expect(() =>
      selectEligibleOrderItem({
        reviewerUserId: "u1",
        productId: "p1",
        reviewerSettledItems: [
          { productId: "p1", orderItemId: "oi1", settledAt: new Date("2026-04-01") },
        ],
        reviewWindowDays: 0,
        now,
        existingReviewsOnItem: 0,
      }),
    ).toThrow(/reviewWindowDays/);
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
