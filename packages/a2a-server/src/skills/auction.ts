// Auction A2A skills: submit_bid (English), accept_dutch, submit_sealed_bid.
// Each composes the matching state-machine call from @marketplace/domain with a
// per-bid mandate check (revocation, expiry, binding, cap). See SOP 09.
//
// State is supplied by the caller; the handler returns the new auction state plus the
// bid record. Persistence is the caller's responsibility.

import { z } from "zod";
import { ForbiddenError } from "@marketplace/shared/errors";
import {
  submitEnglishBid,
  acceptDutch,
  submitSealedBid,
  type EnglishAuction,
  type DutchAuction,
  type SealedBidAuction,
  type Bid,
} from "@marketplace/domain/negotiation/auctions";
import type { A2ASkillDef } from "../server.ts";

const StatusEnum = z.enum(["scheduled", "open", "closed", "settled", "cancelled"]);

const BidInput = z.object({
  bidId: z.string().min(1).max(120),
  bidderAgentId: z.string().min(1).max(120),
  bidderOrgId: z.string().min(1).max(120),
  cartMandateId: z.string().min(1).max(120),
  // Bid amounts are strictly positive — a 0/negative bid would pass
  // `bid.amountMinor > mandate.maxBidMinor` (false for negatives) at the
  // mandate gate and only fail at the inner state machine via the
  // "below required" check. Catch at the boundary so the audit row
  // carries the right error class, matching the same positivity stance
  // applied to refund/dispute/payment amounts (passes #4 / #5 / #12).
  amountMinor: z.bigint().positive(),
  at: z.coerce.date(),
});

// Bound ids + money + currency consistent with the rest of the platform
// (negotiate.ts pass #103, refund/payment passes #94/#95). Reserve price
// is non-negative — a negative reserve makes no economic sense and would
// silently let every bid clear the reserve check in the state machine.
const BaseAuction = {
  auctionId: z.string().min(1).max(120),
  variantId: z.string().min(1).max(120),
  sellerOrgId: z.string().min(1).max(120),
  currency: z.string().regex(/^[A-Z]{3}$/),
  reserveMinor: z.bigint().nonnegative(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  status: StatusEnum,
};

const EnglishAuctionInput = z.object({
  ...BaseAuction,
  kind: z.literal("english"),
  // Starting price + increment are strictly positive. The state machine
  // already rejects a 0 increment (pass #57 — would let same-amount bids
  // stack forever), but bouncing at the schema gate gives a cleaner
  // ValidationError to the caller instead of a deeper ConflictError.
  startingPriceMinor: z.bigint().positive(),
  bidIncrementMinor: z.bigint().positive(),
  // Cap soft-close extension at 1 hour. Without an upper bound, a caller
  // passing `Number.MAX_SAFE_INTEGER` could push `endsAt` arbitrarily far
  // into the future on every bid — effectively a never-closing auction.
  softCloseSeconds: z.number().int().nonnegative().max(3600),
  // Cap bid arrays. The state machine's settle path scans all bids to find
  // the highest amount (auctions/anti-collusion passes); 10k is generous
  // (a real auction has at most a few hundred bids) and bounds the worst
  // case scan to a tractable size.
  bids: z.array(BidInput).max(10_000),
});

const DutchAuctionInput = z.object({
  ...BaseAuction,
  kind: z.literal("dutch"),
  startingPriceMinor: z.bigint().positive(),
  decrementMinor: z.bigint().positive(),
  decrementIntervalSeconds: z.number().int().positive(),
  acceptedBy: BidInput.optional(),
});

const SealedAuctionInput = z.object({
  ...BaseAuction,
  kind: z.literal("sealed_bid"),
  // Same cap as English auctions — bounds the highest-bid scan at settle.
  bids: z.array(BidInput).max(10_000),
});

const MandateInput = z.object({
  cartMandateId: z.string().min(1).max(120),
  auctionId: z.string().min(1).max(120),
  bidderAgentId: z.string().min(1).max(120),
  // Max-bid caps must be strictly positive. A `maxBidMinor: 0n` mandate
  // would reject every legitimate bid via `bid.amountMinor > 0n` while
  // silently accepting a `bid.amountMinor = 0n` (combined with the bid
  // positivity fix above, this is belt-and-suspenders).
  maxBidMinor: z.bigint().positive(),
  revoked: z.boolean().default(false),
  expiresAt: z.coerce.date().optional(),
});

type MandateT = z.infer<typeof MandateInput>;
type BidT = z.infer<typeof BidInput>;

function checkMandate(mandate: MandateT, bid: BidT, auctionId: string): void {
  if (mandate.cartMandateId !== bid.cartMandateId) {
    throw new ForbiddenError("auction_mandate_mismatch");
  }
  if (mandate.auctionId !== auctionId) {
    throw new ForbiddenError("auction_mandate_wrong_auction");
  }
  if (mandate.bidderAgentId !== bid.bidderAgentId) {
    throw new ForbiddenError("auction_mandate_wrong_bidder");
  }
  if (mandate.revoked) {
    throw new ForbiddenError("auction_mandate_revoked");
  }
  if (mandate.expiresAt && mandate.expiresAt <= bid.at) {
    throw new ForbiddenError("auction_mandate_expired");
  }
  if (bid.amountMinor > mandate.maxBidMinor) {
    throw new ForbiddenError(`auction_mandate_cap_exceeded:${mandate.maxBidMinor}`);
  }
}

// ---------- English ----------

const EnglishIn = z.object({
  auction: EnglishAuctionInput,
  mandate: MandateInput,
  bid: BidInput,
});
const EnglishOut = z.object({ auction: EnglishAuctionInput, acceptedBid: BidInput });

export const submitBidSkill: A2ASkillDef<z.infer<typeof EnglishIn>, z.infer<typeof EnglishOut>> = {
  name: "auction.submit_bid",
  description: "Submit a bid in an English auction; enforces mandate cap and increment.",
  scope: "auction:bid",
  inputSchema: EnglishIn,
  outputSchema: EnglishOut,
  handler: ({ auction, mandate, bid }) => {
    checkMandate(mandate, bid, auction.auctionId);
    const next: EnglishAuction = submitEnglishBid(auction as EnglishAuction, bid as Bid);
    return { auction: next, acceptedBid: bid };
  },
};

// ---------- Dutch ----------

const DutchIn = z.object({
  auction: DutchAuctionInput,
  mandate: MandateInput,
  bid: BidInput,
});
const DutchOut = z.object({ auction: DutchAuctionInput, acceptedBid: BidInput });

export const acceptDutchSkill: A2ASkillDef<z.infer<typeof DutchIn>, z.infer<typeof DutchOut>> = {
  name: "auction.accept_dutch",
  description: "Accept the current Dutch-clock price; first valid acceptance wins.",
  scope: "auction:bid",
  inputSchema: DutchIn,
  outputSchema: DutchOut,
  handler: ({ auction, mandate, bid }) => {
    checkMandate(mandate, bid, auction.auctionId);
    const next: DutchAuction = acceptDutch(auction as DutchAuction, bid as Bid);
    return { auction: next, acceptedBid: bid };
  },
};

// ---------- Sealed bid ----------

const SealedIn = z.object({
  auction: SealedAuctionInput,
  mandate: MandateInput,
  bid: BidInput,
});
const SealedOut = z.object({ auction: SealedAuctionInput, acceptedBid: BidInput });

export const submitSealedBidSkill: A2ASkillDef<z.infer<typeof SealedIn>, z.infer<typeof SealedOut>> = {
  name: "auction.submit_sealed_bid",
  description: "Submit a sealed bid; one bid per (bidder, auction) — overwrites prior.",
  scope: "auction:bid",
  inputSchema: SealedIn,
  outputSchema: SealedOut,
  handler: ({ auction, mandate, bid }) => {
    checkMandate(mandate, bid, auction.auctionId);
    const next: SealedBidAuction = submitSealedBid(auction as SealedBidAuction, bid as Bid);
    return { auction: next, acceptedBid: bid };
  },
};
