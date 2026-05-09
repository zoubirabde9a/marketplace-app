// In-process buyer journey for an English auction: a buyer agent submits a sequence
// of bids via the auction.submit_bid A2A skill, then the server settles when the
// auction window closes. Realises scenarios/09-auctions.md (English path) end-to-end.

import { A2ARegistry, type A2AContext } from "@marketplace/a2a-server";
import { submitBidSkill } from "@marketplace/a2a-server/skills/auction";
import {
  settleEnglish,
  type EnglishAuction,
  type Bid,
} from "@marketplace/domain/negotiation/auctions";

export interface AuctionJourneyBidder {
  agentId: string;
  orgId: string;
  cartMandateId: string;
  /** Mandate cap; the journey will never bid beyond this. */
  maxBidMinor: bigint;
  /** Bid timing offset within the auction window, in seconds from open. */
  bidAtSecondsFromOpen: number;
}

export interface AuctionJourneyInput {
  auction: EnglishAuction;
  bidders: AuctionJourneyBidder[];
  /** Settle time, defaulting to one second past `auction.endsAt`. */
  settleAt?: Date;
}

export interface AuctionJourneyResult {
  finalState: EnglishAuction;
  bidsAccepted: number;
  bidsRejected: number;
  rejectionReasons: string[];
  settle: ReturnType<typeof settleEnglish>;
}

export async function runEnglishAuction(input: AuctionJourneyInput): Promise<AuctionJourneyResult> {
  const reg = new A2ARegistry();
  reg.register(submitBidSkill);

  let auction = input.auction;
  let bidsAccepted = 0;
  let bidsRejected = 0;
  const rejectionReasons: string[] = [];

  // Process bids in chronological order so soft-close extension is deterministic.
  const ordered = [...input.bidders].sort(
    (a, b) => a.bidAtSecondsFromOpen - b.bidAtSecondsFromOpen,
  );

  for (let i = 0; i < ordered.length; i++) {
    const b = ordered[i]!;
    const at = new Date(input.auction.startsAt.getTime() + b.bidAtSecondsFromOpen * 1000);

    // Buyer's strategy: bid the next required increment, capped by the mandate.
    const last = auction.bids.at(-1);
    const high = last?.amountMinor ?? auction.startingPriceMinor - auction.bidIncrementMinor;
    const required = high + auction.bidIncrementMinor;
    if (required > b.maxBidMinor) {
      bidsRejected++;
      rejectionReasons.push("self_dropped:cap_below_required");
      continue;
    }

    const bid: Bid = {
      bidId: `bid-${i + 1}`,
      bidderAgentId: b.agentId,
      bidderOrgId: b.orgId,
      cartMandateId: b.cartMandateId,
      amountMinor: required,
      at,
    };

    const ctx: A2AContext = {
      fromAgentId: b.agentId,
      toAgentId: input.auction.sellerOrgId,
      dialogueId: `auction-${input.auction.auctionId}`,
      now: () => at.getTime(),
    };

    try {
      const result = (await reg.invoke(
        "auction.submit_bid",
        {
          auction,
          mandate: {
            cartMandateId: b.cartMandateId,
            auctionId: input.auction.auctionId,
            bidderAgentId: b.agentId,
            maxBidMinor: b.maxBidMinor,
            revoked: false,
          },
          bid,
        },
        ctx,
      )) as { auction: EnglishAuction; acceptedBid: Bid };
      auction = result.auction;
      bidsAccepted++;
    } catch (err) {
      bidsRejected++;
      rejectionReasons.push(err instanceof Error ? err.message : String(err));
    }
  }

  const settleAt = input.settleAt ?? new Date(auction.endsAt.getTime() + 1000);
  const settle = settleEnglish(auction, settleAt);

  return { finalState: auction, bidsAccepted, bidsRejected, rejectionReasons, settle };
}
