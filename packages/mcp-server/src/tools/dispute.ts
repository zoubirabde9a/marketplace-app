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
    description: [
      "Apply a transition to a dispute against the canonical state machine. Rejects invalid transitions.",
      "",
      "Event kinds and the seller-side meaning of each:",
      "  • seller_respond — 'I have read the dispute and am submitting my side / evidence.' Stops the",
      "    auto-escalation timer; expected within the SLA window.",
      "  • escalate — push to platform/operator review. Buyer or seller may escalate; requires a `reason`.",
      "  • resolve_buyer — settle in the buyer's favour (e.g. refund). Seller-initiated concession.",
      "  • resolve_seller — settle in the seller's favour (dispute dismissed). Usually operator-driven.",
      "  • withdraw — buyer drops the dispute (only the buyer can withdraw their own).",
      "",
      "Recommended pattern: call `dispute.check_sla` FIRST to see `hoursToDeadline` and whether",
      "auto-escalation is imminent — that often dictates which event the seller actually wants. Letting",
      "the SLA timer expire without responding leads to automatic escalation, which is worse for the",
      "seller's standing than a timely `seller_respond`.",
      "",
      "The response includes the new SLA snapshot so the agent can immediately tell the operator how",
      "much breathing room (if any) remains.",
    ].join("\n"),
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
    description: [
      "Check SLA pressure for an open dispute. Pure read; cheap to call before any dispute.apply_event.",
      "",
      "Returned fields and what to do with them:",
      "  • `hoursToDeadline`: hours until the dispute auto-escalates. Show this to the operator verbatim",
      "    (e.g. 'You have 18 hours to respond before this auto-escalates.'). Drives urgency.",
      "  • `shouldNotifyApproachingDeadline`: true when the deadline is close enough that the platform",
      "    will start sending nudges. If the operator hasn't responded yet, this is the moment to act.",
      "  • `shouldAutoEscalate`: true when the SLA has effectively expired and the dispute will be",
      "    auto-escalated on the next sweep. At this point, `seller_respond` is still possible but the",
      "    escalation is already imminent — surface that to the operator so they know the standing hit.",
      "",
      "Recommended pattern: any time the agent is about to call `dispute.apply_event`, call this first to",
      "give the operator a concrete deadline number rather than vague 'soon'. Read-only, no audit-write,",
      "no rate-limit-meaningful cost.",
    ].join("\n"),
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
