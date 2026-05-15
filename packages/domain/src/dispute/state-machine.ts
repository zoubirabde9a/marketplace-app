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
  // Validate event-payload invariants at the boundary. The MCP gate
  // (mcp-server/tools/dispute.ts) already rejects empty `escalate.reason`
  // and negative `resolve_buyer.refundMinor` (a zero refund is an
  // apology-only resolution, allowed by spec). But the domain function is
  // callable directly from any other surface — REST, internal sagas,
  // tests, ad-hoc tools. An empty reason yields an audit row with no
  // dispute-investigation context; a negative refund is semantically a
  // CHARGE which the dispute path is not authorised to perform. Same
  // boundary-tightening as the order state-machine (pass #121).
  if (event.kind === "escalate" && event.reason.length === 0) {
    throw new ConflictError("dispute_escalate_reason_required");
  }
  if (event.kind === "resolve_buyer" && event.refundMinor < 0n) {
    throw new ConflictError(`dispute_refund_must_be_nonnegative:${event.refundMinor}`);
  }
  const next = TRANSITIONS[current]?.[event.kind];
  if (!next) throw new ConflictError(`dispute_invalid_transition:${current}->${event.kind}`);
  return next;
}

/**
 * Read-only predicate: does this event apply cleanly given the current
 * dispute state? Lets agents/UIs preview which transitions are available
 * without try/catching applyDisputeEvent — same parity already on the
 * order state machine (canTransition / allowed_events) and the escrow
 * state machine (canApplyEscrowEvent / allowedEscrowEventKinds, pass #20).
 */
export function canApplyDisputeEvent(
  current: DisputeStatus,
  eventKind: DisputeEvent["kind"],
): boolean {
  return TRANSITIONS[current]?.[eventKind] !== undefined;
}

/** Enumerate every event kind that would currently apply cleanly. */
export function allowedDisputeEventKinds(
  current: DisputeStatus,
): ReadonlyArray<DisputeEvent["kind"]> {
  const all: ReadonlyArray<DisputeEvent["kind"]> = [
    "seller_respond",
    "escalate",
    "resolve_buyer",
    "resolve_seller",
    "withdraw",
  ];
  return all.filter((k) => canApplyDisputeEvent(current, k));
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
  // Fail-closed on Invalid Date inputs. Pre-fix, an Invalid Date in
  // `openedAt` or `now` made the subtraction `NaN`, `Math.max(0, NaN) =
  // NaN`, and `remaining <= 0` evaluated to `false` — so the open-dispute
  // auto-escalate gate never fired and disputes silently stuck open
  // past the seller-response SLA. For the SLA evaluator, "treat as
  // already past the deadline" is the safest posture: an oncall ticket
  // is cheap, a dispute that never auto-escalates is not.
  const openedMs = openedAt.getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(openedMs) || !Number.isFinite(nowMs)) {
    return { shouldAutoEscalate: true, shouldNotifyApproachingDeadline: false, hoursToDeadline: 0 };
  }
  // Clamp to non-negative. If `now < openedAt` (clock skew, a record
  // with a future-dated openedAt from a misbehaving caller), elapsedDays
  // would be negative — `remaining = SLA - (-x) = SLA + x` would claim
  // hoursToDeadline > 168 (more than the SLA window) and never auto-
  // escalate. Treat "before the clock started" as "zero elapsed."
  const elapsedDays = Math.max(
    0,
    (nowMs - openedMs) / (24 * 3600 * 1000),
  );
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
