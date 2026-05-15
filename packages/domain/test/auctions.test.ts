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

  it("settles by highest amount, not by array position (defends against out-of-order DB load)", () => {
    // Simulate an auction reloaded from a DB row where bids weren't in
    // submission order — e.g. sorted by `bid.at` with a tie-breaker that
    // doesn't preserve amount order. Previously `a.bids.at(-1)` would
    // pick the wrong winner.
    const a: EnglishAuction = {
      ...baseEnglish(),
      reserveMinor: 0n,
      bids: [
        bid({ amountMinor: 100_00n, bidderAgentId: "high", at: new Date(1000) }),
        bid({ amountMinor: 50_00n,  bidderAgentId: "low",  at: new Date(2000) }),
      ],
    };
    const r = settleEnglish(a, new Date(100_000));
    expect(r.winnerBid?.bidderAgentId).toBe("high");
    expect(r.finalPriceMinor).toBe(100_00n);
  });

  it("rejects zero/negative bidIncrementMinor (would let same-amount bids accumulate)", () => {
    const a = { ...baseEnglish(), bidIncrementMinor: 0n };
    expect(() => submitEnglishBid(a, bid({ amountMinor: 10_00n }))).toThrow(
      /bid_increment_must_be_positive/,
    );
  });

  it("rejects negative softCloseSeconds (would extend endsAt into the past)", () => {
    const a = { ...baseEnglish(), softCloseSeconds: -1 };
    expect(() => submitEnglishBid(a, bid({ amountMinor: 11_00n }))).toThrow(
      /soft_close_negative/,
    );
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

  it("dutchPriceAt rejects a 0 decrementIntervalSeconds (divide-by-zero → BigInt(Infinity) throw)", () => {
    // Pre-fix this fell through `Math.floor(elapsed / 0) = Infinity`, then
    // `BigInt(Infinity)` threw a raw RangeError. Now surfaces as a domain
    // ConflictError so callers can branch on the right error class.
    expect(() => dutchPriceAt({ ...a, decrementIntervalSeconds: 0 }, new Date(10_000))).toThrow(
      /auction_invalid_decrement_interval/,
    );
  });

  it("dutchPriceAt rejects a negative decrementMinor", () => {
    expect(() => dutchPriceAt({ ...a, decrementMinor: -1n }, new Date(10_000))).toThrow(
      /auction_invalid_decrement/,
    );
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

  it("settles ties by first-submitted (stable-sort contract preserved)", () => {
    // Two distinct bidders submit the same amount; the first submission wins.
    // Pre-fix the comparator returned -1 on equality (technically non-stable);
    // V8 timsort happened to preserve order, but the comparator now returns
    // 0 explicitly so the stable-sort contract is honoured portably.
    let s = submitSealedBid(a, bid({ amountMinor: 80_00n, bidderAgentId: "early", at: new Date(1000) }));
    s = submitSealedBid(s, bid({ amountMinor: 80_00n, bidderAgentId: "late",  at: new Date(2000) }));
    const r = settleSealedBid(s, new Date(60_001));
    expect(r.winnerBid?.bidderAgentId).toBe("early");
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
