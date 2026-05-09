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
  if (bid.at < a.startsAt || bid.at > a.endsAt) throw new ConflictError("auction_bid_out_of_window");
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
  if (now < a.endsAt) return { reason: "still_open" };
  const top = a.bids.at(-1);
  if (!top || top.amountMinor < a.reserveMinor) {
    return { reason: "reserve_not_met" };
  }
  return { winnerBid: top, finalPriceMinor: top.amountMinor, reason: "winner" };
}

export function dutchPriceAt(a: DutchAuction, now: Date): bigint {
  if (now < a.startsAt) return a.startingPriceMinor;
  const elapsed = (now.getTime() - a.startsAt.getTime()) / 1000;
  const steps = Math.floor(elapsed / a.decrementIntervalSeconds);
  const drop = BigInt(steps) * a.decrementMinor;
  const computed = a.startingPriceMinor - drop;
  return computed < a.reserveMinor ? a.reserveMinor : computed;
}

export function acceptDutch(a: DutchAuction, bid: Bid): DutchAuction {
  if (a.status !== "open") throw new ConflictError(`auction_not_open:${a.status}`);
  if (a.acceptedBy) throw new ConflictError("auction_already_accepted");
  const price = dutchPriceAt(a, bid.at);
  if (bid.amountMinor < price) throw new ConflictError(`auction_bid_below_clock:${price}`);
  return { ...a, acceptedBy: bid, status: "closed" };
}

export function settleSealedBid(a: SealedBidAuction, now: Date): SettleResult {
  if (now < a.endsAt) return { reason: "still_open" };
  const sorted = [...a.bids].sort((x, y) => (y.amountMinor > x.amountMinor ? 1 : -1));
  const top = sorted[0];
  if (!top || top.amountMinor < a.reserveMinor) return { reason: "reserve_not_met" };
  return { winnerBid: top, finalPriceMinor: top.amountMinor, reason: "winner" };
}

export function submitSealedBid(a: SealedBidAuction, bid: Bid): SealedBidAuction {
  if (a.status !== "open") throw new ConflictError(`auction_not_open:${a.status}`);
  if (bid.at < a.startsAt || bid.at > a.endsAt) throw new ConflictError("auction_bid_out_of_window");
  // One bid per (bidder, auction) — overwrite by bidder
  const others = a.bids.filter((b) => b.bidderAgentId !== bid.bidderAgentId);
  return { ...a, bids: [...others, bid] };
}
