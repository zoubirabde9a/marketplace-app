// Dispute tools — apply a dispute-state-machine transition and report SLA pressure.
// See SOP 07 (dispute).

import { z } from "zod";
import {
  applyDisputeEvent,
  evaluateSla,
  isDisputeTerminal,
  type DisputeStatus,
  type DisputeEvent,
} from "@marketplace/domain/dispute/state-machine";
import { sanitizeUntrustedString, safeOrigin } from "@marketplace/shared/untrusted";
import type { McpRegistry } from "../registry.js";

const StatusEnum = z.enum([
  "open",
  "seller_responded",
  "escalated",
  "resolved_buyer",
  "resolved_seller",
  "withdrawn",
]);

// Reason is buyer/seller-supplied free text destined for the dispute
// escalation record and operator-facing dispute summaries (which may be
// LLM-rendered). Cap at 500 to bound the audit row and DoS risk — same
// limit applied to order cancel/open_dispute reasons (order.ts pass #90).
// Sanitisation is applied in the handler so the persisted text doesn't
// carry `<system>`-style injection payloads into a downstream LLM view.
const EventInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("seller_respond") }),
  z.object({ kind: z.literal("escalate"), reason: z.string().min(1).max(500) }),
  // Refunds can be zero (e.g. a non-monetary apology resolution in the buyer's
  // favour) but never negative — a negative refund would imply charging the
  // buyer more, which the dispute path is not authorised to do.
  z.object({ kind: z.literal("resolve_buyer"), refundMinor: z.bigint().nonnegative() }),
  z.object({ kind: z.literal("resolve_seller") }),
  z.object({ kind: z.literal("withdraw") }),
]);

const TransitionInput = z.object({
  disputeId: z.string(),
  current: StatusEnum,
  event: EventInput,
  openedAt: z.coerce.date(),
  now: z.coerce.date(),
});

const TransitionOutput = z.object({
  disputeId: z.string(),
  previous: StatusEnum,
  next: StatusEnum,
  terminal: z.boolean(),
  sla: z.object({
    shouldAutoEscalate: z.boolean(),
    shouldNotifyApproachingDeadline: z.boolean(),
    hoursToDeadline: z.number().nonnegative(),
  }),
});

const SlaInput = z.object({
  disputeId: z.string(),
  status: StatusEnum,
  openedAt: z.coerce.date(),
  now: z.coerce.date(),
});

const SlaOutput = z.object({
  disputeId: z.string(),
  shouldAutoEscalate: z.boolean(),
  shouldNotifyApproachingDeadline: z.boolean(),
  hoursToDeadline: z.number().nonnegative(),
});

export function registerDisputeTools(reg: McpRegistry): void {
  reg.register({
    name: "dispute.apply_event",
    description:
      "Apply a transition to a dispute (seller_respond / escalate / resolve_buyer / resolve_seller / withdraw). Returns the new status, terminal flag, and current SLA pressure.",
    scope: "dispute:write",
    auditEvent: "dispute.apply_event",
    idempotent: false,
    inputSchema: TransitionInput,
    outputSchema: TransitionOutput,
    handler: async (input, ctx) => {
      // Scrub injection-pattern text from the escalation reason before it
      // lands in the dispute record. See EventInput comment above and
      // order.ts pass #90 for the same defense on order events.
      const event = input.event.kind === "escalate"
        ? {
            ...input.event,
            reason: sanitizeUntrustedString(input.event.reason, {
              maxLength: 500,
              origin: safeOrigin(ctx.ownerKind, ctx.ownerId),
            }),
          }
        : input.event;
      const next: DisputeStatus = applyDisputeEvent(input.current, event as DisputeEvent);
      const sla = evaluateSla(next, input.openedAt, input.now);
      return {
        disputeId: input.disputeId,
        previous: input.current,
        next,
        terminal: isDisputeTerminal(next),
        sla,
      };
    },
    errorCatalog: [
      {
        code: "dispute_invalid_transition",
        httpStatus: 409,
        description: "Requested event is not allowed in the current dispute state.",
      },
    ],
  });

  reg.register({
    name: "dispute.check_sla",
    description:
      "Check SLA pressure for an open dispute: should-auto-escalate, approaching-deadline notice, and hours-remaining.",
    // Read-only: pure function over (status, openedAt, now). Was previously
    // gated on dispute:write, which forced every observer (oncall dashboard,
    // notifier worker, escalation cron) to hold a write capability just to
    // peek at deadline pressure. Now a strict read scope is enough.
    scope: "dispute:read",
    auditEvent: "dispute.check_sla",
    idempotent: true,
    inputSchema: SlaInput,
    outputSchema: SlaOutput,
    handler: async (input) => {
      const sla = evaluateSla(input.status, input.openedAt, input.now);
      return {
        disputeId: input.disputeId,
        shouldAutoEscalate: sla.shouldAutoEscalate,
        shouldNotifyApproachingDeadline: sla.shouldNotifyApproachingDeadline,
        hoursToDeadline: sla.hoursToDeadline,
      };
    },
  });
}
