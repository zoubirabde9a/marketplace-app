import { describe, expect, it } from "vitest";
import { runDisputeLifecycle } from "../src/journeys/dispute-lifecycle.ts";

const OPENED = new Date("2026-04-25T00:00:00Z");
const NOW_INSIDE_SLA = new Date("2026-04-26T00:00:00Z");
const NOW_PAST_SLA = new Date("2026-05-04T00:00:00Z");

const baseInput = {
  orderId: "ord-1",
  disputeId: "d-1",
  orderStatus: "delivered" as const,
  openedAt: OPENED,
  buyerWantsRefundMinor: 5699n,
  sellerResponds: true,
  sellerResponseAction: "accept_buyer_refund" as const,
  refundContext: {
    instrumentKind: "card" as const,
    originalSourceRecreditable: true,
    walletAvailable: false,
    walletOptedOut: false,
    manualPayoutAvailable: false,
    currency: "USD",
  },
  now: NOW_INSIDE_SLA,
};

describe("dispute lifecycle journey (E2E SOP 07 + order/dispute MCP)", () => {
  it("seller accepts buyer refund — order flips disputed → refunded, dispute resolves to buyer", async () => {
    const out = await runDisputeLifecycle(baseInput);
    if (out.outcome.kind !== "resolved_buyer") throw new Error(`unexpected: ${out.outcome.kind}`);
    expect(out.outcome.refundMinor).toBe(5699n);
    expect(out.outcome.refundRouteKind).toBe("original_source");
    expect(out.finalOrderStatus).toBe("refunded");
    const events = out.trace.map((t) => t.event);
    expect(events).toEqual(["open_dispute", "seller_respond", "refund", "resolve_buyer"]);
  });

  it("seller defends → escalation step inserted before resolution", async () => {
    const out = await runDisputeLifecycle({
      ...baseInput,
      sellerResponseAction: "defend",
    });
    if (out.outcome.kind !== "resolved_buyer") throw new Error(`unexpected: ${out.outcome.kind}`);
    const events = out.trace.map((t) => t.event);
    expect(events).toEqual(["open_dispute", "seller_respond", "escalate", "refund", "resolve_buyer"]);
  });

  it("seller settles in their favor → no refund, dispute terminates", async () => {
    const out = await runDisputeLifecycle({
      ...baseInput,
      sellerResponseAction: "settle_seller",
    });
    expect(out.outcome.kind).toBe("resolved_seller");
    expect(out.finalOrderStatus).toBe("disputed"); // no refund applied
  });

  it("buyer withdraws after seller responds → withdrawn", async () => {
    const out = await runDisputeLifecycle({
      ...baseInput,
      sellerResponseAction: "withdraw",
    });
    expect(out.outcome.kind).toBe("withdrawn");
    const events = out.trace.map((t) => t.event);
    expect(events).toEqual(["open_dispute", "seller_respond", "withdraw"]);
  });

  it("seller silent past 7d SLA → auto-escalated", async () => {
    const out = await runDisputeLifecycle({
      ...baseInput,
      sellerResponds: false,
      now: NOW_PAST_SLA,
    });
    expect(out.outcome.kind).toBe("auto_escalated");
    expect(out.slaWhenOpened.shouldAutoEscalate).toBe(true);
    expect(out.trace.map((t) => t.event)).toEqual(["open_dispute", "escalate"]);
  });

  it("opens dispute against shipped order (not delivered)", async () => {
    const out = await runDisputeLifecycle({ ...baseInput, orderStatus: "shipped" });
    expect(out.outcome.kind).toBe("resolved_buyer");
    expect(out.trace[0]).toMatchObject({ from: "shipped", event: "open_dispute", to: "disputed" });
  });

  it("refund routes to wallet when original source is not recreditable", async () => {
    const out = await runDisputeLifecycle({
      ...baseInput,
      refundContext: {
        ...baseInput.refundContext!,
        originalSourceRecreditable: false,
        walletAvailable: true,
      },
    });
    if (out.outcome.kind !== "resolved_buyer") throw new Error(`unexpected: ${out.outcome.kind}`);
    expect(out.outcome.refundRouteKind).toBe("wallet");
  });
});
