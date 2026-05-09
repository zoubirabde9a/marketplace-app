import { describe, expect, it } from "vitest";
import {
  acceptDutch,
  dutchPriceAt,
  settleEnglish,
  settleSealedBid,
  submitEnglishBid,
  submitSealedBid,
  type Bid,
  type DutchAuction,
  type EnglishAuction,
  type SealedBidAuction,
} from "../src/negotiation/auctions.js";

const baseEnglish = (): EnglishAuction => ({
  auctionId: "a1",
  kind: "english",
  variantId: "v1",
  sellerOrgId: "s1",
  currency: "USD",
  reserveMinor: 50_00n,
  startsAt: new Date(0),
  endsAt: new Date(60_000),
  status: "open",
  startingPriceMinor: 10_00n,
  bidIncrementMinor: 1_00n,
  softCloseSeconds: 30,
  bids: [],
});

const bid = (overrides: Partial<Bid> = {}): Bid => ({
  bidId: "b" + Math.random(),
  bidderAgentId: "a1",
  bidderOrgId: "o1",
  cartMandateId: "m1",
  amountMinor: 11_00n,
  at: new Date(1000),
  ...overrides,
});

describe("English auction", () => {
  it("requires bid ≥ high+increment", () => {
    let a = baseEnglish();
    a = submitEnglishBid(a, bid({ amountMinor: 11_00n }));
    expect(() => submitEnglishBid(a, bid({ amountMinor: 11_50n }))).toThrow(/below_required/);
    a = submitEnglishBid(a, bid({ amountMinor: 12_00n, at: new Date(2000) }));
    expect(a.bids).toHaveLength(2);
  });

  it("soft-closes by extending end on late bid", () => {
    let a = baseEnglish();
    a = submitEnglishBid(a, bid({ amountMinor: 11_00n, at: new Date(50_000) }));
    expect(a.endsAt.getTime()).toBe(50_000 + 30_000);
  });

  it("settles winner above reserve", () => {
    let a = baseEnglish();
    a = submitEnglishBid(a, bid({ amountMinor: 60_00n }));
    const r = settleEnglish(a, new Date(100_000));
    expect(r.finalPriceMinor).toBe(60_00n);
  });

  it("returns no winner when reserve unmet", () => {
    let a = baseEnglish();
    a = submitEnglishBid(a, bid({ amountMinor: 11_00n }));
    const r = settleEnglish(a, new Date(100_000));
    expect(r.reason).toBe("reserve_not_met");
  });
});

describe("Dutch auction", () => {
  const a: DutchAuction = {
    auctionId: "d1",
    kind: "dutch",
    variantId: "v1",
    sellerOrgId: "s1",
    currency: "USD",
    reserveMinor: 5_00n,
    startsAt: new Date(0),
    endsAt: new Date(60_000),
    status: "open",
    startingPriceMinor: 100_00n,
    decrementMinor: 5_00n,
    decrementIntervalSeconds: 10,
  };

  it("descends on schedule but never below reserve", () => {
    expect(dutchPriceAt(a, new Date(0))).toBe(100_00n);
    expect(dutchPriceAt(a, new Date(10_000))).toBe(95_00n);
    expect(dutchPriceAt(a, new Date(60_000))).toBe(70_00n);
    expect(dutchPriceAt({ ...a, startingPriceMinor: 10_00n }, new Date(60_000))).toBe(5_00n); // floored at reserve
  });

  it("first acceptance wins, status closed", () => {
    const updated = acceptDutch(a, bid({ amountMinor: 95_00n, at: new Date(10_000) }));
    expect(updated.status).toBe("closed");
    expect(updated.acceptedBy).toBeDefined();
    expect(() => acceptDutch(updated, bid({ amountMinor: 90_00n, at: new Date(20_000) }))).toThrow();
  });
});

describe("Sealed-bid auction", () => {
  const a: SealedBidAuction = {
    auctionId: "sb1",
    kind: "sealed_bid",
    variantId: "v1",
    sellerOrgId: "s1",
    currency: "USD",
    reserveMinor: 50_00n,
    startsAt: new Date(0),
    endsAt: new Date(60_000),
    status: "open",
    bids: [],
  };

  it("overwrites previous bid from same bidder", () => {
    let s = submitSealedBid(a, bid({ amountMinor: 60_00n }));
    s = submitSealedBid(s, bid({ amountMinor: 70_00n, at: new Date(20_000) }));
    expect(s.bids).toHaveLength(1);
    expect(s.bids[0]?.amountMinor).toBe(70_00n);
  });

  it("settles to highest bid above reserve", () => {
    let s = submitSealedBid(a, bid({ amountMinor: 55_00n, bidderAgentId: "x" }));
    s = submitSealedBid(s, bid({ amountMinor: 80_00n, bidderAgentId: "y" }));
    const r = settleSealedBid(s, new Date(100_000));
    expect(r.finalPriceMinor).toBe(80_00n);
  });

  it("no winner when no bid above reserve", () => {
    const s = submitSealedBid(a, bid({ amountMinor: 10_00n }));
    const r = settleSealedBid(s, new Date(100_000));
    expect(r.reason).toBe("reserve_not_met");
  });
});
