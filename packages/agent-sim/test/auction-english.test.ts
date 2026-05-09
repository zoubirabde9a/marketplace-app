import { describe, expect, it } from "vitest";
import type { EnglishAuction } from "@marketplace/domain/negotiation/auctions";
import { runEnglishAuction } from "../src/journeys/auction-english.ts";

const baseAuction = (): EnglishAuction => ({
  auctionId: "auc-e2e",
  kind: "english",
  variantId: "ACME-K12-MB",
  sellerOrgId: "org_acme",
  currency: "USD",
  reserveMinor: 8000n,
  startsAt: new Date("2026-05-04T18:00:00Z"),
  endsAt: new Date("2026-05-04T19:00:00Z"),
  status: "open",
  startingPriceMinor: 5000n,
  bidIncrementMinor: 100n,
  softCloseSeconds: 120,
  bids: [],
});

describe("English auction journey (E2E)", () => {
  it("two competing bidders — higher cap wins above reserve", async () => {
    // Lower the reserve so a small bid sequence can clear it.
    const auction = { ...baseAuction(), reserveMinor: 5200n };
    const out = await runEnglishAuction({
      auction,
      bidders: [
        { agentId: "buyer-1", orgId: "org_b1", cartMandateId: "mnd-1", maxBidMinor: 9000n, bidAtSecondsFromOpen: 60 },
        { agentId: "buyer-2", orgId: "org_b2", cartMandateId: "mnd-2", maxBidMinor: 12000n, bidAtSecondsFromOpen: 120 },
        { agentId: "buyer-1", orgId: "org_b1", cartMandateId: "mnd-1", maxBidMinor: 9000n, bidAtSecondsFromOpen: 180 },
        { agentId: "buyer-2", orgId: "org_b2", cartMandateId: "mnd-2", maxBidMinor: 12000n, bidAtSecondsFromOpen: 240 },
      ],
    });
    expect(out.bidsAccepted).toBe(4);
    expect(out.bidsRejected).toBe(0);
    expect(out.settle.reason).toBe("winner");
    expect(out.settle.winnerBid?.bidderAgentId).toBe("buyer-2");
    // Sequence: 5000, 5100, 5200, 5300 → top is 5300.
    expect(out.settle.finalPriceMinor).toBe(5300n);
  });

  it("drops own bid when mandate cap < next required increment", async () => {
    const out = await runEnglishAuction({
      auction: baseAuction(),
      bidders: [
        { agentId: "buyer-1", orgId: "org_b1", cartMandateId: "mnd-1", maxBidMinor: 4999n, bidAtSecondsFromOpen: 60 },
      ],
    });
    expect(out.bidsAccepted).toBe(0);
    expect(out.bidsRejected).toBe(1);
    expect(out.rejectionReasons[0]).toBe("self_dropped:cap_below_required");
    expect(out.settle.reason).toBe("reserve_not_met");
  });

  it("settles with no winner when reserve is not met", async () => {
    const auction = baseAuction();
    const out = await runEnglishAuction({
      auction,
      bidders: [
        { agentId: "buyer-1", orgId: "org_b1", cartMandateId: "mnd-1", maxBidMinor: 7500n, bidAtSecondsFromOpen: 60 },
      ],
    });
    // 1 bid at 5100 → < reserve 8000.
    expect(out.bidsAccepted).toBe(1);
    expect(out.settle.reason).toBe("reserve_not_met");
    expect(out.settle.winnerBid).toBeUndefined();
  });

  it("soft-close extends end time when a bid lands inside the window", async () => {
    const auction = baseAuction();
    // Schedule a bid 30s before close — softCloseSeconds=120 → end pushed to bid.at+120s
    const out = await runEnglishAuction({
      auction,
      bidders: [
        { agentId: "buyer-1", orgId: "org_b1", cartMandateId: "mnd-1", maxBidMinor: 12000n, bidAtSecondsFromOpen: 60 * 60 - 30 },
      ],
    });
    const expectedEnd = new Date(auction.startsAt.getTime() + (60 * 60 - 30) * 1000 + 120 * 1000);
    expect(out.finalState.endsAt.toISOString()).toBe(expectedEnd.toISOString());
  });

  it("rejects bid bound to a mandate for a different auction", async () => {
    const auction = { ...baseAuction(), auctionId: "auc-e2e" };
    // Submit-skill check: mandate.auctionId !== auction.auctionId.
    // Simulate this by handing a mandate-cap-OK bidder, but mismatching the journey wiring.
    // Easiest path: pass a bidder whose cartMandateId doesn't match what the journey will send.
    // The journey constructs the mandate inline matching `b.cartMandateId`, so to force the
    // wrong-auction path we run a custom invocation outside the journey helper instead.
    const { A2ARegistry } = await import("@marketplace/a2a-server");
    const { submitBidSkill } = await import("@marketplace/a2a-server/skills/auction");
    const reg = new A2ARegistry();
    reg.register(submitBidSkill);
    await expect(
      reg.invoke(
        "auction.submit_bid",
        {
          auction,
          mandate: {
            cartMandateId: "mnd-1",
            auctionId: "auc-DIFFERENT",
            bidderAgentId: "buyer-1",
            maxBidMinor: 12000n,
            revoked: false,
          },
          bid: {
            bidId: "bid-1",
            bidderAgentId: "buyer-1",
            bidderOrgId: "org_b1",
            cartMandateId: "mnd-1",
            amountMinor: 5100n,
            at: new Date("2026-05-04T18:30:00Z"),
          },
        },
        {
          fromAgentId: "buyer-1",
          toAgentId: "org_acme",
          dialogueId: "d-1",
          now: () => 0,
        },
      ),
    ).rejects.toThrow(/auction_mandate_wrong_auction/);
  });
});
