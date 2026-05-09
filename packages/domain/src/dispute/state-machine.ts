// Dispute state machine.
// open → seller_responded → escalated → resolved_{buyer,seller} | withdrawn

import { ConflictError } from "@marketplace/shared/errors";

export type DisputeStatus =
  | "open"
  | "seller_responded"
  | "escalated"
  | "resolved_buyer"
  | "resolved_seller"
  | "withdrawn";

export type DisputeEvent =
  | { kind: "seller_respond" }
  | { kind: "escalate"; reason: string }
  | { kind: "resolve_buyer"; refundMinor: bigint }
  | { kind: "resolve_seller" }
  | { kind: "withdraw" };

const TRANSITIONS: Record<DisputeStatus, Partial<Record<DisputeEvent["kind"], DisputeStatus>>> = {
  open: {
    seller_respond: "seller_responded",
    escalate: "escalated",
    resolve_buyer: "resolved_buyer",
    resolve_seller: "resolved_seller",
    withdraw: "withdrawn",
  },
  seller_responded: {
    escalate: "escalated",
    resolve_buyer: "resolved_buyer",
    resolve_seller: "resolved_seller",
    withdraw: "withdrawn",
  },
  escalated: {
    resolve_buyer: "resolved_buyer",
    resolve_seller: "resolved_seller",
    withdraw: "withdrawn",
  },
  resolved_buyer: {},
  resolved_seller: {},
  withdrawn: {},
};

export function applyDisputeEvent(current: DisputeStatus, event: DisputeEvent): DisputeStatus {
  const next = TRANSITIONS[current]?.[event.kind];
  if (!next) throw new ConflictError(`dispute_invalid_transition:${current}->${event.kind}`);
  return next;
}

export function isDisputeTerminal(status: DisputeStatus): boolean {
  return status === "resolved_buyer" || status === "resolved_seller" || status === "withdrawn";
}

/** Spec: seller has 7 days to respond, then auto-escalate. */
export const SELLER_RESPONSE_SLA_DAYS = 7;
export const ESCALATION_SLA_DAYS = 14;

export interface SlaResult {
  shouldAutoEscalate: boolean;
  shouldNotifyApproachingDeadline: boolean;
  hoursToDeadline: number;
}

export function evaluateSla(status: DisputeStatus, openedAt: Date, now: Date): SlaResult {
  const elapsedDays = (now.getTime() - openedAt.getTime()) / (24 * 3600 * 1000);
  if (status === "open") {
    const remaining = SELLER_RESPONSE_SLA_DAYS - elapsedDays;
    return {
      shouldAutoEscalate: remaining <= 0,
      shouldNotifyApproachingDeadline: remaining > 0 && remaining < 1,
      hoursToDeadline: Math.max(0, remaining * 24),
    };
  }
  if (status === "seller_responded" || status === "escalated") {
    const remaining = ESCALATION_SLA_DAYS - elapsedDays;
    return {
      shouldAutoEscalate: false,
      shouldNotifyApproachingDeadline: remaining > 0 && remaining < 2,
      hoursToDeadline: Math.max(0, remaining * 24),
    };
  }
  return { shouldAutoEscalate: false, shouldNotifyApproachingDeadline: false, hoursToDeadline: 0 };
}
