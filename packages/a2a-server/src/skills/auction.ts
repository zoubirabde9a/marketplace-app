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
  bidId: z.string(),
  bidderAgentId: z.string(),
  bidderOrgId: z.string(),
  cartMandateId: z.string(),
  amountMinor: z.bigint(),
  at: z.coerce.date(),
});

const BaseAuction = {
  auctionId: z.string(),
  variantId: z.string(),
  sellerOrgId: z.string(),
  currency: z.string(),
  reserveMinor: z.bigint(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  status: StatusEnum,
};

const EnglishAuctionInput = z.object({
  ...BaseAuction,
  kind: z.literal("english"),
  startingPriceMinor: z.bigint(),
  bidIncrementMinor: z.bigint(),
  softCloseSeconds: z.number().int().nonnegative(),
  bids: z.array(BidInput),
});

const DutchAuctionInput = z.object({
  ...BaseAuction,
  kind: z.literal("dutch"),
  startingPriceMinor: z.bigint(),
  decrementMinor: z.bigint(),
  decrementIntervalSeconds: z.number().int().positive(),
  acceptedBy: BidInput.optional(),
});

const SealedAuctionInput = z.object({
  ...BaseAuction,
  kind: z.literal("sealed_bid"),
  bids: z.array(BidInput),
});

const MandateInput = z.object({
  cartMandateId: z.string(),
  auctionId: z.string(),
  bidderAgentId: z.string(),
  maxBidMinor: z.bigint(),
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
