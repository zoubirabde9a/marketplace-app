import { describe, expect, it } from "vitest";
import { A2ARegistry, type A2AContext } from "../src/server.ts";
import { submitBidSkill } from "../src/skills/auction.ts";

const ctx = (): A2AContext => ({
  fromAgentId: "buyer-1",
  toAgentId: "seller-1",
  dialogueId: "dlg-1",
  now: () => Date.now(),
});

const baseAuction = {
  auctionId: "auc-1",
  kind: "english" as const,
  variantId: "ACME-K12-MB",
  sellerOrgId: "org_acme",
  currency: "USD",
  reserveMinor: 8000n,
  startsAt: new Date("2026-05-04T18:00:00Z"),
  endsAt: new Date("2026-05-04T19:00:00Z"),
  status: "open" as const,
  startingPriceMinor: 5000n,
  bidIncrementMinor: 100n,
  softCloseSeconds: 120,
  bids: [],
};

const baseMandate = {
  cartMandateId: "mnd-1",
  auctionId: "auc-1",
  bidderAgentId: "buyer-1",
  maxBidMinor: 12000n,
  revoked: false,
};

const baseBid = {
  bidId: "bid-1",
  bidderAgentId: "buyer-1",
  bidderOrgId: "org_buyer",
  cartMandateId: "mnd-1",
  amountMinor: 5100n,
  at: new Date("2026-05-04T18:30:00Z"),
};

const invoke = async (input: unknown) => {
  const reg = new A2ARegistry();
  reg.register(submitBidSkill);
  return reg.invoke("auction.submit_bid", input, ctx());
};

describe("auction.submit_bid skill", () => {
  it("accepts a first bid at starting price + increment", async () => {
    const out = (await invoke({
      auction: baseAuction,
      mandate: baseMandate,
      bid: baseBid,
    })) as { auction: typeof baseAuction; acceptedBid: typeof baseBid };
    expect(out.auction.bids.length).toBe(1);
    expect(out.acceptedBid.bidId).toBe("bid-1");
  });

  it("rejects bid above mandate cap before mutating auction", async () => {
    await expect(
      invoke({
        auction: baseAuction,
        mandate: { ...baseMandate, maxBidMinor: 5000n },
        bid: { ...baseBid, amountMinor: 5100n },
      }),
    ).rejects.toThrow(/auction_mandate_cap_exceeded:5000/);
  });

  it("rejects revoked mandate", async () => {
    await expect(
      invoke({ auction: baseAuction, mandate: { ...baseMandate, revoked: true }, bid: baseBid }),
    ).rejects.toThrow(/auction_mandate_revoked/);
  });

  it("rejects mandate expired before the bid time", async () => {
    await expect(
      invoke({
        auction: baseAuction,
        mandate: { ...baseMandate, expiresAt: new Date("2026-05-04T18:00:00Z") },
        bid: baseBid,
      }),
    ).rejects.toThrow(/auction_mandate_expired/);
  });

  it("rejects mandate bound to a different auction", async () => {
    await expect(
      invoke({
        auction: baseAuction,
        mandate: { ...baseMandate, auctionId: "auc-other" },
        bid: baseBid,
      }),
    ).rejects.toThrow(/auction_mandate_wrong_auction/);
  });

  it("rejects mandate bound to a different bidder", async () => {
    await expect(
      invoke({
        auction: baseAuction,
        mandate: { ...baseMandate, bidderAgentId: "buyer-2" },
        bid: baseBid,
      }),
    ).rejects.toThrow(/auction_mandate_wrong_bidder/);
  });

  it("rejects bid mandate-id that doesn't match the supplied mandate", async () => {
    await expect(
      invoke({
        auction: baseAuction,
        mandate: baseMandate,
        bid: { ...baseBid, cartMandateId: "mnd-other" },
      }),
    ).rejects.toThrow(/auction_mandate_mismatch/);
  });

  it("propagates auction state-machine error on below-increment bid", async () => {
    const auctionWithBid = {
      ...baseAuction,
      bids: [{ ...baseBid, amountMinor: 6000n }],
    };
    await expect(
      invoke({
        auction: auctionWithBid,
        mandate: baseMandate,
        bid: { ...baseBid, bidId: "bid-2", amountMinor: 6050n }, // need 6100
      }),
    ).rejects.toThrow(/auction_bid_below_required:6100/);
  });

  it("rejects bid outside the auction window", async () => {
    await expect(
      invoke({
        auction: baseAuction,
        mandate: baseMandate,
        bid: { ...baseBid, at: new Date("2026-05-04T20:00:00Z") },
      }),
    ).rejects.toThrow(/auction_bid_out_of_window/);
  });

  it("rejects bid on auction not open", async () => {
    await expect(
      invoke({
        auction: { ...baseAuction, status: "closed" as const },
        mandate: baseMandate,
        bid: baseBid,
      }),
    ).rejects.toThrow(/auction_not_open:closed/);
  });

  it("extends end time on soft-close (anti-snipe)", async () => {
    const lateBid = { ...baseBid, at: new Date("2026-05-04T18:59:30Z") };
    const out = (await invoke({
      auction: baseAuction,
      mandate: baseMandate,
      bid: lateBid,
    })) as { auction: { endsAt: Date } };
    // softCloseSeconds=120 → new endsAt = bid.at + 120s = 19:01:30
    expect(out.auction.endsAt.toISOString()).toBe("2026-05-04T19:01:30.000Z");
  });
});
