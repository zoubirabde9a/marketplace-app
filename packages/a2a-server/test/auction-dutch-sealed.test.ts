import { describe, expect, it } from "vitest";
import { dutchPriceAt } from "@marketplace/domain/negotiation/auctions";
import { A2ARegistry, type A2AContext } from "../src/server.ts";
import { acceptDutchSkill, submitSealedBidSkill } from "../src/skills/auction.ts";

const ctx = (): A2AContext => ({
  fromAgentId: "buyer-1",
  toAgentId: "seller-1",
  dialogueId: "dlg-1",
  now: () => Date.now(),
});

const baseMandate = {
  cartMandateId: "mnd-1",
  auctionId: "auc-d",
  bidderAgentId: "buyer-1",
  maxBidMinor: 12000n,
  revoked: false,
};

const baseBid = {
  bidId: "bid-1",
  bidderAgentId: "buyer-1",
  bidderOrgId: "org_buyer",
  cartMandateId: "mnd-1",
  amountMinor: 9500n,
  at: new Date("2026-05-04T18:30:00Z"),
};

describe("auction.accept_dutch skill", () => {
  const baseDutch = {
    auctionId: "auc-d",
    kind: "dutch" as const,
    variantId: "ACME-K12-MB",
    sellerOrgId: "org_acme",
    currency: "USD",
    reserveMinor: 5000n,
    startsAt: new Date("2026-05-04T18:00:00Z"),
    endsAt: new Date("2026-05-04T19:00:00Z"),
    status: "open" as const,
    startingPriceMinor: 12000n,
    decrementMinor: 100n,
    decrementIntervalSeconds: 60,
  };

  const invoke = async (input: unknown) => {
    const reg = new A2ARegistry();
    reg.register(acceptDutchSkill);
    return reg.invoke("auction.accept_dutch", input, ctx());
  };

  it("accepts when bid >= current clock price", async () => {
    const at = new Date("2026-05-04T18:30:00Z"); // 30 min in → 30 decrements → 12000-3000=9000
    expect(dutchPriceAt(baseDutch as any, at)).toBe(9000n);
    const out = (await invoke({
      auction: baseDutch,
      mandate: baseMandate,
      bid: { ...baseBid, amountMinor: 9000n, at },
    })) as { auction: { status: string; acceptedBy: { bidId: string } } };
    expect(out.auction.status).toBe("closed");
    expect(out.auction.acceptedBy.bidId).toBe("bid-1");
  });

  it("rejects bid below current clock price", async () => {
    await expect(
      invoke({
        auction: baseDutch,
        mandate: baseMandate,
        bid: { ...baseBid, amountMinor: 8000n, at: new Date("2026-05-04T18:30:00Z") },
      }),
    ).rejects.toThrow(/auction_bid_below_clock:9000/);
  });

  it("rejects second acceptance after winner is chosen", async () => {
    const won = {
      ...baseDutch,
      status: "open" as const,
      acceptedBy: { ...baseBid, amountMinor: 9000n },
    };
    await expect(
      invoke({
        auction: won,
        mandate: baseMandate,
        bid: { ...baseBid, bidId: "bid-2", amountMinor: 9000n },
      }),
    ).rejects.toThrow(/auction_already_accepted/);
  });

  it("clock floors at reserve", async () => {
    const at = new Date("2026-05-04T22:00:00Z"); // far past — would go below reserve
    expect(dutchPriceAt(baseDutch as any, at)).toBe(5000n);
  });

  it("enforces mandate cap before state-machine call", async () => {
    await expect(
      invoke({
        auction: baseDutch,
        mandate: { ...baseMandate, maxBidMinor: 8000n },
        bid: { ...baseBid, amountMinor: 9000n, at: new Date("2026-05-04T18:30:00Z") },
      }),
    ).rejects.toThrow(/auction_mandate_cap_exceeded:8000/);
  });
});

describe("auction.submit_sealed_bid skill", () => {
  const baseSealed = {
    auctionId: "auc-d",
    kind: "sealed_bid" as const,
    variantId: "ACME-K12-MB",
    sellerOrgId: "org_acme",
    currency: "USD",
    reserveMinor: 5000n,
    startsAt: new Date("2026-05-04T18:00:00Z"),
    endsAt: new Date("2026-05-04T19:00:00Z"),
    status: "open" as const,
    bids: [],
  };

  const invoke = async (input: unknown) => {
    const reg = new A2ARegistry();
    reg.register(submitSealedBidSkill);
    return reg.invoke("auction.submit_sealed_bid", input, ctx());
  };

  it("accepts an in-window sealed bid", async () => {
    const out = (await invoke({
      auction: baseSealed,
      mandate: baseMandate,
      bid: baseBid,
    })) as { auction: { bids: Array<{ bidId: string }> } };
    expect(out.auction.bids).toHaveLength(1);
    expect(out.auction.bids[0]?.bidId).toBe("bid-1");
  });

  it("overwrites a prior bid from the same bidder", async () => {
    const withFirst = {
      ...baseSealed,
      bids: [{ ...baseBid, bidId: "bid-prev", amountMinor: 7000n }],
    };
    const out = (await invoke({
      auction: withFirst,
      mandate: baseMandate,
      bid: { ...baseBid, bidId: "bid-new", amountMinor: 9000n },
    })) as { auction: { bids: Array<{ bidId: string; amountMinor: bigint }> } };
    expect(out.auction.bids).toHaveLength(1);
    expect(out.auction.bids[0]?.bidId).toBe("bid-new");
    expect(out.auction.bids[0]?.amountMinor).toBe(9000n);
  });

  it("preserves bids from other bidders when one bidder updates", async () => {
    const withOther = {
      ...baseSealed,
      bids: [
        { ...baseBid, bidId: "bid-other", bidderAgentId: "buyer-2", cartMandateId: "mnd-2", amountMinor: 6500n },
      ],
    };
    const out = (await invoke({
      auction: withOther,
      mandate: baseMandate,
      bid: baseBid,
    })) as { auction: { bids: Array<{ bidderAgentId: string }> } };
    expect(out.auction.bids.map((b) => b.bidderAgentId).sort()).toEqual(["buyer-1", "buyer-2"]);
  });

  it("rejects bid outside the auction window", async () => {
    await expect(
      invoke({
        auction: baseSealed,
        mandate: baseMandate,
        bid: { ...baseBid, at: new Date("2026-05-04T20:00:00Z") },
      }),
    ).rejects.toThrow(/auction_bid_out_of_window/);
  });

  it("rejects bid on closed sealed auction", async () => {
    await expect(
      invoke({
        auction: { ...baseSealed, status: "closed" as const },
        mandate: baseMandate,
        bid: baseBid,
      }),
    ).rejects.toThrow(/auction_not_open:closed/);
  });

  it("enforces mandate cap on sealed bid", async () => {
    await expect(
      invoke({
        auction: baseSealed,
        mandate: { ...baseMandate, maxBidMinor: 9000n },
        bid: { ...baseBid, amountMinor: 9500n },
      }),
    ).rejects.toThrow(/auction_mandate_cap_exceeded:9000/);
  });
});
