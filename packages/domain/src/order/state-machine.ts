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
  const next = TRANSITIONS[current]?.[event.kind];
  if (!next) {
    throw new ConflictError(`order_invalid_transition:${current}->${event.kind}`);
  }
  return next;
}

export function canTransition(current: OrderStatus, event: OrderEvent["kind"]): boolean {
  return TRANSITIONS[current]?.[event] !== undefined;
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
