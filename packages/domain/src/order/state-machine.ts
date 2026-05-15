// Order state machine — spec §4.5.
// Transitions are deterministic; no implicit timeouts here.

import { ConflictError } from "@marketplace/shared/errors";

export type OrderStatus =
  | "created"
  | "authorized"
  | "paid"
  | "fulfilling"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded"
  | "disputed";

export type OrderEvent =
  | { kind: "authorize" }
  | { kind: "capture" }
  | { kind: "begin_fulfillment" }
  | { kind: "ship" }
  | { kind: "deliver" }
  | { kind: "cancel"; reason: string }
  | { kind: "refund"; amountMinor: bigint }
  | { kind: "open_dispute"; reason: string };

const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderEvent["kind"], OrderStatus>>> = {
  created: { authorize: "authorized", cancel: "cancelled" },
  authorized: { capture: "paid", cancel: "cancelled" },
  paid: { begin_fulfillment: "fulfilling", cancel: "cancelled", refund: "refunded", open_dispute: "disputed" },
  fulfilling: { ship: "shipped", cancel: "cancelled", refund: "refunded", open_dispute: "disputed" },
  shipped: { deliver: "delivered", refund: "refunded", open_dispute: "disputed" },
  delivered: { refund: "refunded", open_dispute: "disputed" },
  cancelled: {},
  refunded: { open_dispute: "disputed" },
  disputed: { refund: "refunded" },
};

export const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set(["cancelled"]);

export function applyEvent(current: OrderStatus, event: OrderEvent): OrderStatus {
  // Validate event-payload invariants at the boundary. The MCP gate
  // (mcp-server/tools/order.ts) already rejects zero/negative refunds and
  // empty cancel/open_dispute reasons, but the domain function is callable
  // directly from any other surface (REST, internal sagas, tests, future
  // ad-hoc tools). A zero-amount refund would still collapse the order to
  // "refunded" without any money moving — a silent accounting hole. A
  // negative-amount refund is semantically a charge, which the refund
  // event is not authorised to perform. Empty reason strings yield audit
  // rows with no context — useless for dispute investigations later.
  if (event.kind === "refund" && event.amountMinor <= 0n) {
    throw new ConflictError(`order_refund_amount_must_be_positive:${event.amountMinor}`);
  }
  if ((event.kind === "cancel" || event.kind === "open_dispute") && event.reason.length === 0) {
    throw new ConflictError(`order_event_reason_required:${event.kind}`);
  }
  const next = TRANSITIONS[current]?.[event.kind];
  if (!next) {
    throw new ConflictError(`order_invalid_transition:${current}->${event.kind}`);
  }
  return next;
}

export function canTransition(current: OrderStatus, event: OrderEvent["kind"]): boolean {
  return TRANSITIONS[current]?.[event] !== undefined;
}

/**
 * Enumerate every event kind that would currently apply cleanly. Mirrors the
 * dispute (`allowedDisputeEventKinds`) and escrow (`allowedEscrowEventKinds`)
 * state machines so a generic state-aware UI / MCP tool can ask the same
 * shape of question against any of the three. Keeping the canonical event
 * list in the domain means consumers (the MCP `order.allowed_events` tool,
 * any future REST surface, internal saga code) don't each have to maintain
 * a private copy of ALL_EVENT_KINDS.
 */
export function allowedOrderEventKinds(
  current: OrderStatus,
): ReadonlyArray<OrderEvent["kind"]> {
  const all: ReadonlyArray<OrderEvent["kind"]> = [
    "authorize",
    "capture",
    "begin_fulfillment",
    "ship",
    "deliver",
    "cancel",
    "refund",
    "open_dispute",
  ];
  return all.filter((k) => canTransition(current, k));
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
