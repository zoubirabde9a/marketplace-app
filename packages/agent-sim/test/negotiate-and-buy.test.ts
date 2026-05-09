import { describe, expect, it } from "vitest";
import { runNegotiateAndBuy } from "../src/journeys/negotiate-and-buy.ts";
import type { SellerOfferPolicy } from "@marketplace/domain/negotiation/negotiate";

const basePolicy: SellerOfferPolicy = {
  sellerOrgId: "org_acme",
  variantId: "ACME-K12-MB",
  floorPriceMinor: 4500n,
  listPriceMinor: 5999n,
  currency: "USD",
  quantityBands: [
    { minQty: 10, discountBps: 500 },
    { minQty: 50, discountBps: 1200 },
  ],
};

describe("buyer journey: negotiate and add to cart", () => {
  it("accepts a proposal that lands inside the band", async () => {
    const result = await runNegotiateAndBuy({
      buyerAgentId: "agt_buyer",
      sellerAgentId: "agt_seller",
      policy: basePolicy,
      qty: 25,
      proposedUnitPriceMinor: 5800n,
      buyerMaxUnitPriceMinor: 5800n,
    });
    expect(result.outcome).toBe("accepted");
    expect(result.finalUnitPriceMinor).toBe(5800n);
    expect(result.cart).toHaveLength(1);
    expect(result.cart[0]).toMatchObject({
      variantId: "ACME-K12-MB",
      sellerId: "org_acme",
      qty: 25,
      unitPriceMinor: 5800n,
    });
    expect(result.cart[0]?.negotiatedQuoteId).toMatch(/^dlg-agt_buyer-/);
    expect(result.exchanges).toBe(1);
  });

  it("walks the counter-offer when the buyer's ceiling allows it", async () => {
    const result = await runNegotiateAndBuy({
      buyerAgentId: "agt_buyer",
      sellerAgentId: "agt_seller",
      policy: basePolicy,
      qty: 25,
      proposedUnitPriceMinor: 5400n, // below band → server counters at 5699
      buyerMaxUnitPriceMinor: 5700n,
    });
    expect(result.outcome).toBe("counter_accepted");
    expect(result.finalUnitPriceMinor).toBe(5700n);
    expect(result.exchanges).toBe(2);
    expect(result.cart[0]?.unitPriceMinor).toBe(5700n);
  });

  it("walks away when the counter exceeds buyer's ceiling", async () => {
    const result = await runNegotiateAndBuy({
      buyerAgentId: "agt_buyer",
      sellerAgentId: "agt_seller",
      policy: basePolicy,
      qty: 25,
      proposedUnitPriceMinor: 5400n,
      buyerMaxUnitPriceMinor: 5500n, // counter at 5699 > 5500
    });
    expect(result.outcome).toBe("walked_away");
    expect(result.cart).toHaveLength(0);
    expect(result.exchanges).toBe(1);
  });

  it("walks away when the proposal is below the seller's floor and no counter would land", async () => {
    const result = await runNegotiateAndBuy({
      buyerAgentId: "agt_buyer",
      sellerAgentId: "agt_seller",
      policy: basePolicy,
      qty: 1,
      proposedUnitPriceMinor: 100n, // far below floor 4500
      buyerMaxUnitPriceMinor: 4000n,
    });
    expect(result.outcome).toBe("walked_away");
    expect(result.cart).toHaveLength(0);
  });
});
