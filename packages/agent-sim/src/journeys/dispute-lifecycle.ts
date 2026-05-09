// End-to-end dispute journey: a delivered order is disputed, the seller responds (or
// not), and the case settles via the configured outcome. Crosses the order
// state-machine MCP and the dispute MCP. Realises SOP 07 (dispute) plus the dispute
// branch of SOP 03/05.

import { McpRegistry, type McpContext } from "@marketplace/mcp-server/registry";
import { registerOrderTools } from "@marketplace/mcp-server/tools/order";
import { registerDisputeTools } from "@marketplace/mcp-server/tools/dispute";
import { registerRefundTools } from "@marketplace/mcp-server/tools/refund";

export type DisputeOutcome =
  | { kind: "resolved_buyer"; refundMinor: bigint; refundRouteKind: string }
  | { kind: "resolved_seller" }
  | { kind: "withdrawn" }
  | { kind: "auto_escalated" };

export interface DisputeJourneyInput {
  orderId: string;
  disputeId: string;
  /** Order's status at the time the dispute opens. Must allow open_dispute. */
  orderStatus: "paid" | "fulfilling" | "shipped" | "delivered" | "refunded";
  openedAt: Date;
  /** Buyer's preferred outcome. */
  buyerWantsRefundMinor?: bigint;
  /** Whether the seller responds at all. If `false` and `now` is past the SLA, journey auto-escalates. */
  sellerResponds: boolean;
  /** What the seller's response triggers: defend (escalate), accept (resolve_buyer), settle in seller's favor. */
  sellerResponseAction: "defend" | "accept_buyer_refund" | "settle_seller" | "withdraw";
  refundContext?: {
    instrumentKind: "card" | "bank" | "wallet" | "virtual_card" | "stablecoin";
    originalSourceRecreditable: boolean;
    walletAvailable: boolean;
    walletOptedOut: boolean;
    manualPayoutAvailable: boolean;
    currency: string;
  };
  now: Date;
}

export interface DisputeJourneyResult {
  outcome: DisputeOutcome;
  trace: Array<{ from: string; event: string; to: string; terminal: boolean }>;
  finalOrderStatus: string;
  slaWhenOpened: { shouldAutoEscalate: boolean; hoursToDeadline: number };
}

function buildCtx(scopes: string[]): McpContext {
  return {
    agentId: "agt_lifecycle",
    passportId: "psp_lifecycle",
    scopes: new Set(scopes),
    ownerKind: "user",
    ownerId: "usr_lifecycle",
    requestId: "req-dispute",
    now: () => Date.now(),
    emitAudit: async () => {},
  };
}

export async function runDisputeLifecycle(input: DisputeJourneyInput): Promise<DisputeJourneyResult> {
  const reg = new McpRegistry();
  registerOrderTools(reg);
  registerDisputeTools(reg);
  registerRefundTools(reg);

  const trace: DisputeJourneyResult["trace"] = [];

  // 1) Buyer opens a dispute against the delivered order. The order moves to "disputed".
  const orderEvt = (await reg.invoke(
    "order.apply_event",
    {
      orderId: input.orderId,
      current: input.orderStatus,
      event: { kind: "open_dispute", reason: "buyer_dispute" },
    },
    buildCtx(["order:cancel"]),
  )) as { previous: string; next: string; terminal: boolean };
  trace.push({ from: orderEvt.previous, event: "open_dispute", to: orderEvt.next, terminal: orderEvt.terminal });

  // 2) Capture SLA snapshot at "open" so the journey can show whether auto-escalate would fire.
  const slaSnapshot = (await reg.invoke(
    "dispute.check_sla",
    {
      disputeId: input.disputeId,
      status: "open",
      openedAt: input.openedAt.toISOString(),
      now: input.now.toISOString(),
    },
    buildCtx(["dispute:write"]),
  )) as { shouldAutoEscalate: boolean; hoursToDeadline: number };

  // 3) Seller might or might not respond.
  let disputeStatus = "open";
  let finalOrderStatus = orderEvt.next;
  if (!input.sellerResponds) {
    if (slaSnapshot.shouldAutoEscalate) {
      // Auto-escalate path: server forces the transition to "escalated".
      const out = (await reg.invoke(
        "dispute.apply_event",
        {
          disputeId: input.disputeId,
          current: "open",
          event: { kind: "escalate", reason: "seller_response_sla_exceeded" },
          openedAt: input.openedAt.toISOString(),
          now: input.now.toISOString(),
        },
        buildCtx(["dispute:write"]),
      )) as { previous: string; next: string; terminal: boolean };
      trace.push({ from: out.previous, event: "escalate", to: out.next, terminal: out.terminal });
      return {
        outcome: { kind: "auto_escalated" },
        trace,
        finalOrderStatus,
        slaWhenOpened: slaSnapshot,
      };
    }
    // Inside SLA but seller still hasn't responded — stay in `open`. Out of scope here; bail.
    throw new Error("dispute_seller_not_responded_within_sla");
  }

  // Seller responded.
  const respond = (await reg.invoke(
    "dispute.apply_event",
    {
      disputeId: input.disputeId,
      current: "open",
      event: { kind: "seller_respond" },
      openedAt: input.openedAt.toISOString(),
      now: input.now.toISOString(),
    },
    buildCtx(["dispute:write"]),
  )) as { previous: string; next: string; terminal: boolean };
  trace.push({ from: respond.previous, event: "seller_respond", to: respond.next, terminal: respond.terminal });
  disputeStatus = respond.next;

  // 4) Apply the seller's chosen action.
  if (input.sellerResponseAction === "defend") {
    const esc = (await reg.invoke(
      "dispute.apply_event",
      {
        disputeId: input.disputeId,
        current: disputeStatus,
        event: { kind: "escalate", reason: "seller_defends" },
        openedAt: input.openedAt.toISOString(),
        now: input.now.toISOString(),
      },
      buildCtx(["dispute:write"]),
    )) as { previous: string; next: string; terminal: boolean };
    trace.push({ from: esc.previous, event: "escalate", to: esc.next, terminal: esc.terminal });
    disputeStatus = esc.next;
  }

  // 5) Resolution.
  if (input.sellerResponseAction === "withdraw") {
    const w = (await reg.invoke(
      "dispute.apply_event",
      {
        disputeId: input.disputeId,
        current: disputeStatus,
        event: { kind: "withdraw" },
        openedAt: input.openedAt.toISOString(),
        now: input.now.toISOString(),
      },
      buildCtx(["dispute:write"]),
    )) as { previous: string; next: string; terminal: boolean };
    trace.push({ from: w.previous, event: "withdraw", to: w.next, terminal: w.terminal });
    return { outcome: { kind: "withdrawn" }, trace, finalOrderStatus, slaWhenOpened: slaSnapshot };
  }

  if (input.sellerResponseAction === "settle_seller") {
    const r = (await reg.invoke(
      "dispute.apply_event",
      {
        disputeId: input.disputeId,
        current: disputeStatus,
        event: { kind: "resolve_seller" },
        openedAt: input.openedAt.toISOString(),
        now: input.now.toISOString(),
      },
      buildCtx(["dispute:write"]),
    )) as { previous: string; next: string; terminal: boolean };
    trace.push({ from: r.previous, event: "resolve_seller", to: r.next, terminal: r.terminal });
    return { outcome: { kind: "resolved_seller" }, trace, finalOrderStatus, slaWhenOpened: slaSnapshot };
  }

  // Buyer refund. Pick a refund route, apply order.refund, apply dispute.resolve_buyer.
  const refundMinor = input.buyerWantsRefundMinor ?? 0n;
  let routeKind = "credit_note_vdc";
  if (input.refundContext) {
    const route = (await reg.invoke(
      "refund.preview_route",
      {
        refundId: `ref-${input.disputeId}`,
        amountMinor: refundMinor,
        currency: input.refundContext.currency,
        ctx: {
          instrumentKind: input.refundContext.instrumentKind,
          originalSourceRecreditable: input.refundContext.originalSourceRecreditable,
          walletAvailable: input.refundContext.walletAvailable,
          walletOptedOut: input.refundContext.walletOptedOut,
          manualPayoutAvailable: input.refundContext.manualPayoutAvailable,
        },
      },
      buildCtx(["return:write"]),
    )) as { routeKind: string };
    routeKind = route.routeKind;
  }

  // Order: disputed → refunded.
  const orderRefund = (await reg.invoke(
    "order.apply_event",
    {
      orderId: input.orderId,
      current: orderEvt.next,
      event: { kind: "refund", amountMinor: refundMinor },
    },
    buildCtx(["order:cancel"]),
  )) as { previous: string; next: string };
  trace.push({ from: orderRefund.previous, event: "refund", to: orderRefund.next, terminal: false });
  finalOrderStatus = orderRefund.next;

  // Dispute resolution: resolve_buyer.
  const resolveBuyer = (await reg.invoke(
    "dispute.apply_event",
    {
      disputeId: input.disputeId,
      current: disputeStatus,
      event: { kind: "resolve_buyer", refundMinor },
      openedAt: input.openedAt.toISOString(),
      now: input.now.toISOString(),
    },
    buildCtx(["dispute:write"]),
  )) as { previous: string; next: string; terminal: boolean };
  trace.push({ from: resolveBuyer.previous, event: "resolve_buyer", to: resolveBuyer.next, terminal: resolveBuyer.terminal });

  return {
    outcome: { kind: "resolved_buyer", refundMinor, refundRouteKind: routeKind },
    trace,
    finalOrderStatus,
    slaWhenOpened: slaSnapshot,
  };
}
