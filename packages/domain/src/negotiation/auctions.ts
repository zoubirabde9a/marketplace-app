// Auction state machines per spec §7b — English, Dutch, sealed-bid.
//
// All bids are mandate-bound: the buyer's Cart Mandate pre-authorizes a max bid.
// Mandate verification & cap enforcement happens at submitBid time via the caller.

import { ConflictError } from "@marketplace/shared/errors";

export type AuctionKind = "english" | "dutch" | "sealed_bid";
export type AuctionStatus = "scheduled" | "open" | "closed" | "settled" | "cancelled";

export interface AuctionBase {
  auctionId: string;
  kind: AuctionKind;
  variantId: string;
  sellerOrgId: string;
  currency: string;
  /** Reserve price — opaque to buyers per spec. */
  reserveMinor: bigint;
  startsAt: Date;
  endsAt: Date;
  status: AuctionStatus;
}

export interface Bid {
  bidId: string;
  bidderAgentId: string;
  bidderOrgId: string;
  cartMandateId: string;
  amountMinor: bigint;
  at: Date;
}

// English auction: ascending, highest visible bid wins, soft-close extension.
export interface EnglishAuction extends AuctionBase {
  kind: "english";
  startingPriceMinor: bigint;
  bidIncrementMinor: bigint;
  /** Anti-sniping: any bid in last `softCloseSeconds` extends end by that amount. */
  softCloseSeconds: number;
  bids: Bid[];
}

// Dutch auction: descending, first acceptance wins.
export interface DutchAuction extends AuctionBase {
  kind: "dutch";
  startingPriceMinor: bigint;
  decrementMinor: bigint;
  decrementIntervalSeconds: number;
  acceptedBy?: Bid;
}

// Sealed-bid: hidden bids, single window, highest above reserve wins.
export interface SealedBidAuction extends AuctionBase {
  kind: "sealed_bid";
  bids: Bid[]; // hidden until settle
}

export type Auction = EnglishAuction | DutchAuction | SealedBidAuction;

export interface SettleResult {
  winnerBid?: Bid;
  finalPriceMinor?: bigint;
  reason: string;
}

export function submitEnglishBid(a: EnglishAuction, bid: Bid): EnglishAuction {
  if (a.status !== "open") throw new ConflictError(`auction_not_open:${a.status}`);
  // Fail-closed on Invalid Date for the bid timestamp. Pre-fix `bid.at <
  // a.startsAt` evaluated to `false` (NaN coercion) and `bid.at > a.endsAt`
  // likewise — so a bid with `new Date("not-a-date")` bypassed BOTH window
  // checks and was accepted at any time, including after settle. Same NaN-
  // bypass family as escrow / velocity / restricted-items windows.
  if (!Number.isFinite(bid.at.getTime())) {
    throw new ConflictError("auction_bid_at_invalid");
  }
  if (bid.at < a.startsAt || bid.at > a.endsAt) throw new ConflictError("auction_bid_out_of_window");
  // Hard invariants on auction configuration. Without these, a misconfigured
  // auction lets the same bid value win repeatedly (zero increment) or
  // produces a soft-close that moves endsAt INTO THE PAST (negative window).
  if (a.bidIncrementMinor <= 0n) {
    throw new ConflictError("auction_bid_increment_must_be_positive");
  }
  if (a.softCloseSeconds < 0) {
    throw new ConflictError("auction_soft_close_negative");
  }
  const high = a.bids.length === 0 ? a.startingPriceMinor - a.bidIncrementMinor : a.bids.at(-1)!.amountMinor;
  const required = high + a.bidIncrementMinor;
  if (bid.amountMinor < required) throw new ConflictError(`auction_bid_below_required:${required}`);
  // Soft-close extension
  let endsAt = a.endsAt;
  const softWindowMs = a.softCloseSeconds * 1000;
  if (a.endsAt.getTime() - bid.at.getTime() < softWindowMs) {
    endsAt = new Date(bid.at.getTime() + softWindowMs);
  }
  return { ...a, bids: [...a.bids, bid], endsAt };
}

export function settleEnglish(a: EnglishAuction, now: Date): SettleResult {
  // Fail-closed on Invalid Date for `now` — pre-fix `Invalid Date < endsAt`
  // evaluated false (NaN coercion), so a corrupted clock would slip past
  // the still-open gate and the function would commit a settle on an
  // auction that hasn't actually ended. Treat "no usable now" as
  // "still_open" so the caller retries with a valid clock instead of
  // locking in a winner against a NaN.
  if (!Number.isFinite(now.getTime())) return { reason: "still_open" };
  if (now < a.endsAt) return { reason: "still_open" };
  if (a.bids.length === 0) return { reason: "reserve_not_met" };
  // Pick the highest bid by AMOUNT, not by array position. The state-machine
  // invariant — bids appended in monotonically increasing order — holds when
  // every bid comes through `submitEnglishBid`. But an auction reloaded from
  // a DB row where bids were ordered differently (e.g. by `bid.at` with a
  // tie-breaker that doesn't preserve amount order) would silently award
  // the wrong winner with `a.bids.at(-1)`. Re-sort defensively at settle.
  // BigInt-safe explicit comparator; stable sort keeps first-submitted-wins
  // for any rare tie at the top amount.
  const sortedDesc = [...a.bids].sort((x, y) => {
    if (x.amountMinor < y.amountMinor) return 1;
    if (x.amountMinor > y.amountMinor) return -1;
    return 0;
  });
  const top = sortedDesc[0]!;
  if (top.amountMinor < a.reserveMinor) {
    return { reason: "reserve_not_met" };
  }
  return { winnerBid: top, finalPriceMinor: top.amountMinor, reason: "winner" };
}

export function dutchPriceAt(a: DutchAuction, now: Date): bigint {
  // Fail-closed on Invalid Date for either the auction or the now-clock.
  // Pre-fix `now.getTime() - startsAt.getTime()` could produce NaN, then
  // `Math.floor(NaN / interval)` → NaN, then `BigInt(NaN)` throws raw
  // `RangeError` out of the function. Same NaN-bypass family as the
  // submitEnglishBid / submitSealedBid guards (pass #127).
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(a.startsAt.getTime())) {
    throw new ConflictError("auction_dutch_clock_invalid");
  }
  if (now < a.startsAt) return a.startingPriceMinor;
  // A misconfigured auction (decrementIntervalSeconds <= 0, decrementMinor
  // negative, or a stale DB row that pre-dates the schema's positivity
  // tightening) would otherwise produce `Infinity / NaN` going through
  // `Math.floor → BigInt`, throwing a raw `RangeError` from the BigInt
  // coercion. Surface as a domain ConflictError so callers can branch on
  // the right class.
  if (a.decrementIntervalSeconds <= 0) {
    throw new ConflictError(
      `auction_invalid_decrement_interval:${a.decrementIntervalSeconds}`,
    );
  }
  if (a.decrementMinor < 0n) {
    throw new ConflictError(`auction_invalid_decrement:${a.decrementMinor}`);
  }
  const elapsed = (now.getTime() - a.startsAt.getTime()) / 1000;
  const steps = Math.floor(elapsed / a.decrementIntervalSeconds);
  const drop = BigInt(steps) * a.decrementMinor;
  const computed = a.startingPriceMinor - drop;
  return computed < a.reserveMinor ? a.reserveMinor : computed;
}

export function acceptDutch(a: DutchAuction, bid: Bid): DutchAuction {
  if (a.status !== "open") throw new ConflictError(`auction_not_open:${a.status}`);
  if (a.acceptedBy) throw new ConflictError("auction_already_accepted");
  // Reject bids outside [startsAt, endsAt]. Pre-fix the function only
  // checked `status === "open"` — but an auction whose endsAt has passed
  // but hasn't been settled yet (between the clock-end and the operator
  // running a settle job) would still accept new bids and lock in a price
  // computed against `dutchPriceAt`'s clock. Add the same window guard
  // submitEnglishBid / submitSealedBid (passes #127 / #185) enforce.
  // Also fail-closed on Invalid Date for bid.at — `dutchPriceAt` would
  // catch this downstream but throw a different error class.
  if (!Number.isFinite(bid.at.getTime())) {
    throw new ConflictError("auction_bid_at_invalid");
  }
  if (bid.at < a.startsAt || bid.at > a.endsAt) {
    throw new ConflictError("auction_bid_out_of_window");
  }
  const price = dutchPriceAt(a, bid.at);
  if (bid.amountMinor < price) throw new ConflictError(`auction_bid_below_clock:${price}`);
  return { ...a, acceptedBy: bid, status: "closed" };
}

export function settleSealedBid(a: SealedBidAuction, now: Date): SettleResult {
  // Same Invalid-Date guard as settleEnglish (pass #187).
  if (!Number.isFinite(now.getTime())) return { reason: "still_open" };
  if (now < a.endsAt) return { reason: "still_open" };
  // Explicit −1/0/+1 BigInt-safe comparator. The previous `y > x ? 1 : -1`
  // returned -1 on equal amounts — non-zero on equal pairs technically
  // breaks the stable-sort contract callers rely on for tie-breaking
  // (first-submitted wins). V8's timsort happened to give the right
  // observable order, but explicit zero on equal is correct + portable.
  // Same fix family as the catalog sort comparator (pass #34).
  const sorted = [...a.bids].sort((x, y) => {
    if (x.amountMinor < y.amountMinor) return 1; // larger amount first (desc)
    if (x.amountMinor > y.amountMinor) return -1;
    return 0; // equal — preserve submission order via stable sort
  });
  const top = sorted[0];
  if (!top || top.amountMinor < a.reserveMinor) return { reason: "reserve_not_met" };
  return { winnerBid: top, finalPriceMinor: top.amountMinor, reason: "winner" };
}

export function submitSealedBid(a: SealedBidAuction, bid: Bid): SealedBidAuction {
  if (a.status !== "open") throw new ConflictError(`auction_not_open:${a.status}`);
  // Same fail-closed Invalid-Date guard as submitEnglishBid.
  if (!Number.isFinite(bid.at.getTime())) {
    throw new ConflictError("auction_bid_at_invalid");
  }
  if (bid.at < a.startsAt || bid.at > a.endsAt) throw new ConflictError("auction_bid_out_of_window");
  // One bid per (bidder, auction) — overwrite by bidder
  const others = a.bids.filter((b) => b.bidderAgentId !== bid.bidderAgentId);
  return { ...a, bids: [...others, bid] };
}
