import { describe, expect, it } from "vitest";
import { priceQuote } from "../src/checkout/quote.js";

const buyer = {
  shipToCountry: "US",
  isSanctionedParty: false,
  carriersAvailable: [{ key: "ups", prohibitedItems: [] }],
};

describe("priceQuote", () => {
  it("computes totals and emits cart hash", () => {
    const q = priceQuote({
      cart: {
        cartId: "c1",
        currency: "USD",
        lines: [{ variantId: "v1", sellerId: "s1", qty: 2, unitPriceMinor: 100_00n }],
      },
      shippingOptions: [{ carrier: "ups", service: "ground", costMinor: 5_00n, estDeliveryDays: 5 }],
      taxBreakdown: [{ variantId: "v1", taxMinor: 16_50n, zoneId: "z1", rateBps: 825 }],
      classifications: [
        {
          taxonomyKeys: ["electronics"],
          isHazmat: false,
          isAgeRestricted: false,
          countryOfOrigin: "US",
          productId: "p1",
        },
      ],
      buyer,
      rules: [],
      now: new Date("2026-05-03"),
    });
    expect(q.totals.subtotalMinor).toBe(200_00n);
    expect(q.totals.shippingMinor).toBe(5_00n);
    expect(q.totals.taxMinor).toBe(16_50n);
    expect(q.totals.totalMinor).toBe(200_00n + 5_00n + 16_50n);
    expect(q.cartHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("blocks via restricted-items rule", () => {
    expect(() =>
      priceQuote({
        cart: {
          cartId: "c1",
          currency: "USD",
          lines: [{ variantId: "v1", sellerId: "s1", qty: 1, unitPriceMinor: 100_00n }],
        },
        shippingOptions: [],
        taxBreakdown: [],
        classifications: [
          {
            taxonomyKeys: ["weapons"],
            isHazmat: false,
            isAgeRestricted: false,
            countryOfOrigin: "US",
            productId: "p1",
          },
        ],
        buyer,
        rules: [
          {
            taxonomyKey: "weapons",
            countryCode: "US",
            restrictionKind: "prohibited",
            effectiveFrom: new Date("2020-01-01"),
            registryVersion: "v1",
          },
        ],
        now: new Date("2026-05-03"),
      }),
    ).toThrow(/listing_blocked/);
  });
});
