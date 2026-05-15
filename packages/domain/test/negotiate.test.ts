import { describe, expect, it } from "vitest";
import { evaluateNegotiation, transcriptHash, type SellerOfferPolicy } from "../src/negotiation/negotiate.js";

const policy: SellerOfferPolicy = {
  sellerOrgId: "s1",
  variantId: "v1",
  floorPriceMinor: 50_00n,
  listPriceMinor: 100_00n,
  currency: "USD",
  quantityBands: [
    { minQty: 1, maxQty: 9, discountBps: 0 },
    { minQty: 10, maxQty: 49, discountBps: 1000 },
    { minQty: 50, discountBps: 2000 },
  ],
};

describe("evaluateNegotiation", () => {
  const now = new Date("2026-05-03");

  it("accepts offer within quantity band", () => {
    const r = evaluateNegotiation(policy, {
      buyerAgentId: "a1",
      buyerSegments: [],
      qty: 12,
      proposedUnitPriceMinor: 90_00n,
      now,
    });
    expect(r.accepted).toBe(true);
    expect(r.effectiveDiscountBps).toBe(1000);
  });

  it("rejects below-floor without leaking the private floor in a counter", () => {
    // Spec §7b: floor price is PRIVATE. Pre-fix the response set
    // `counterUnitPriceMinor: policy.floorPriceMinor`, revealing the
    // floor to a probing buyer on the very first below-floor offer.
    const r = evaluateNegotiation(policy, {
      buyerAgentId: "a1",
      buyerSegments: [],
      qty: 1,
      proposedUnitPriceMinor: 30_00n,
      now,
    });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("below_floor_price");
    // No counter — the buyer doesn't learn the floor.
    expect(r.counterUnitPriceMinor).toBeUndefined();
  });

  it("rejects discount beyond band, counters with band-implied price", () => {
    const r = evaluateNegotiation(policy, {
      buyerAgentId: "a1",
      buyerSegments: [],
      qty: 5,
      proposedUnitPriceMinor: 80_00n, // 20% off but band allows 0%
      now,
    });
    expect(r.accepted).toBe(false);
    expect(r.counterUnitPriceMinor).toBe(100_00n);
  });

  it("blocks forbidden buyer segment", () => {
    const p = { ...policy, forbiddenSegments: ["embargoed_region"] };
    expect(() =>
      evaluateNegotiation(p, {
        buyerAgentId: "a1",
        buyerSegments: ["embargoed_region"],
        qty: 1,
        proposedUnitPriceMinor: 100_00n,
        now,
      }),
    ).toThrow(/segment_blocked/);
  });

  it("applies time-limited promo on top of band", () => {
    const p: SellerOfferPolicy = {
      ...policy,
      promo: {
        extraDiscountBps: 500,
        startsAt: new Date("2026-05-01"),
        endsAt: new Date("2026-05-31"),
      },
    };
    const r = evaluateNegotiation(p, {
      buyerAgentId: "a1",
      buyerSegments: [],
      qty: 12, // band 10%
      proposedUnitPriceMinor: 85_00n, // 15% off, allowed by 10+5
      now,
    });
    expect(r.accepted).toBe(true);
  });
});

describe("transcriptHash", () => {
  it("is stable for same inputs", () => {
    const t = {
      dialogueId: "d1",
      buyerAgentId: "a1",
      sellerAgentId: "a2",
      variantId: "v1",
      exchanges: [{ at: new Date(0), speaker: "buyer" as const, payload: { offer: 100 } }],
    };
    expect(transcriptHash(t)).toBe(transcriptHash(t));
  });

  it("survives bigint payloads (typical negotiation prices are bigint-typed)", () => {
    // Plain JSON.stringify throws `TypeError: Do not know how to serialize
    // a BigInt` — every transcript with a price would fail to hash, and
    // every consumer of the audit/dispute evidence trail silently 500'd.
    const t = {
      dialogueId: "d-big",
      buyerAgentId: "a1",
      sellerAgentId: "a2",
      variantId: "v1",
      exchanges: [
        { at: new Date(0), speaker: "buyer" as const, payload: { offerMinor: 99_99n, qty: 12 } },
        { at: new Date(1000), speaker: "seller" as const, payload: { counterMinor: 110_00n } },
      ],
    };
    const h = transcriptHash(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
