import { describe, expect, it } from "vitest";
import { runBuyerPurchase, type PurchaseLine } from "../src/journeys/buyer-purchase.ts";

const NOW = new Date("2026-05-04T18:00:00Z");
const PAST = new Date("2025-01-01T00:00:00Z");

const carriers = [{ key: "default", prohibitedItems: [] }];

const benignLine: PurchaseLine = {
  productId: "p-shirt",
  listingId: "l-shirt",
  variantId: "v-shirt-m",
  sellerId: "org_acme",
  unitPriceMinor: 2500n,
  qty: 1,
  taxonomyKeys: ["apparel/shirts"],
  isHazmat: false,
  isAgeRestricted: false,
  countryOfOrigin: "US",
};

const ageLine: PurchaseLine = {
  productId: "p-wine",
  listingId: "l-wine",
  variantId: "v-wine-1",
  sellerId: "org_winery",
  unitPriceMinor: 4000n,
  qty: 1,
  taxonomyKeys: ["alcohol"],
  isHazmat: false,
  isAgeRestricted: true,
  minAge: 21,
  countryOfOrigin: "US",
};

const ageRule = {
  taxonomyKey: "alcohol",
  countryCode: "US",
  restrictionKind: "age_restricted" as const,
  minAge: 21,
  effectiveFrom: PAST,
  registryVersion: "rules-v42",
};

const baseInput = {
  buyerUserId: "usr_buyer",
  shipToCountry: "US",
  isSanctionedParty: false,
  carriersAvailable: carriers,
  rules: [],
  candidates: [benignLine],
  reviewWindowDays: 60,
  reviewBody: "Solid product",
  reviewRating: 5,
  now: NOW,
};

describe("buyer purchase journey (E2E SOP 03 + 12)", () => {
  it("benign cart → all lines pass gate, review posts visible", async () => {
    const out = await runBuyerPurchase(baseInput);
    expect(out.cart).toHaveLength(1);
    expect(out.blockedLines).toEqual([]);
    expect(out.reviewOutcome).toEqual({ posted: true, status: "visible", suspicionScore: 0 });
  });

  it("mixed cart: blocked age-restricted line is dropped, benign line ships", async () => {
    const out = await runBuyerPurchase({
      ...baseInput,
      candidates: [benignLine, ageLine],
      rules: [ageRule],
      // buyer hasn't verified age, so age line should drop
    });
    expect(out.cart).toHaveLength(1);
    expect(out.blockedLines).toHaveLength(1);
    expect(out.blockedLines[0]).toMatchObject({
      listingId: "l-wine",
      reasonClass: "recoverable",
    });
    expect(out.blockedLines[0]?.reason).toMatch(/age_verification_required_21/);
  });

  it("verified age 21 → age-restricted line passes the gate", async () => {
    const out = await runBuyerPurchase({
      ...baseInput,
      candidates: [ageLine],
      rules: [ageRule],
      buyerVerifiedAge: 21,
    });
    expect(out.cart).toHaveLength(1);
    expect(out.blockedLines).toEqual([]);
  });

  it("entire cart blocked → checkout refuses, no review attempted", async () => {
    const out = await runBuyerPurchase({
      ...baseInput,
      candidates: [ageLine],
      rules: [ageRule],
      // no buyerVerifiedAge → only line blocks
    });
    expect(out.cart).toEqual([]);
    expect(out.settledOrderItems).toEqual([]);
    expect(out.reviewOutcome).toEqual({ posted: false, reason: "no_eligible_cart_lines" });
  });

  it("self-review signal → review posted but suppressed by moderation", async () => {
    const out = await runBuyerPurchase({
      ...baseInput,
      reviewSignals: { burstCount: 0, burstThreshold: 5, incentiveDetected: false, selfReview: true, honeypotEcho: false },
    });
    expect(out.cart).toHaveLength(1);
    expect(out.reviewOutcome).toMatchObject({ posted: true, status: "suppressed" });
  });

  it("review window of 1 day with settlement at NOW → still eligible", async () => {
    const out = await runBuyerPurchase({
      ...baseInput,
      reviewWindowDays: 1,
    });
    expect(out.reviewOutcome).toMatchObject({ posted: true });
  });

  it("sanctioned buyer → all lines hard-blocked, no settle, no review", async () => {
    const out = await runBuyerPurchase({
      ...baseInput,
      isSanctionedParty: true,
    });
    expect(out.cart).toEqual([]);
    expect(out.blockedLines).toHaveLength(1);
    expect(out.blockedLines[0]?.reason).toBe("buyer_sanctioned_party");
    expect(out.blockedLines[0]?.reasonClass).toBe("hard");
    expect(out.reviewOutcome).toEqual({ posted: false, reason: "no_eligible_cart_lines" });
  });
});
