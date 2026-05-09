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
import type { McpRegistry } from "../registry.js";

const StatusEnum = z.enum([
  "open",
  "seller_responded",
  "escalated",
  "resolved_buyer",
  "resolved_seller",
  "withdrawn",
]);

const EventInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("seller_respond") }),
  z.object({ kind: z.literal("escalate"), reason: z.string().min(1) }),
  z.object({ kind: z.literal("resolve_buyer"), refundMinor: z.bigint() }),
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
    handler: async (input) => {
      const next: DisputeStatus = applyDisputeEvent(input.current, input.event as DisputeEvent);
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
    scope: "dispute:write",
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
