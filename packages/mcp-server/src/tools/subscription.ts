// Subscription tools — preview the §7.1 renewal decision and (separately) the
// post-failure retry schedule. Both are pure functions so the tool is idempotent.
// See SOP 08.

import { z } from "zod";
import {
  evaluateRenewal,
  planRetry,
  preChargeNotificationDue,
} from "@marketplace/domain/subscription/renewal";
import type { SubscriptionState } from "@marketplace/domain/subscription/renewal";
import type { McpRegistry } from "../registry.js";

const StatusEnum = z.enum(["active", "paused", "cancelled", "expired"]);

const StateSchema = z.object({
  status: StatusEnum,
  nextRenewalAt: z.coerce.date(),
  retryCount: z.number().int().min(0),
  lastFailureAt: z.coerce.date().optional(),
  mandateRefreshDueAt: z.coerce.date(),
  totalCapMinor: z.bigint().optional(),
  consumedMinor: z.bigint(),
  endAfterCycles: z.number().int().positive().optional(),
  cyclesCompleted: z.number().int().min(0),
});

const PreviewInput = z.object({
  subscriptionId: z.string(),
  state: StateSchema,
  amountMinor: z.bigint(),
  now: z.coerce.date(),
});

const OutcomeSchema = z.union([
  z.object({ kind: z.literal("skip"), reason: z.string() }),
  z.object({ kind: z.literal("charge_now") }),
  z.object({
    kind: z.literal("schedule_retry"),
    nextAttemptAt: z.coerce.date(),
    retryCount: z.number().int(),
  }),
  z.object({ kind: z.literal("auto_pause"), reason: z.string() }),
  z.object({ kind: z.literal("mandate_refresh_required") }),
]);

const PreviewOutput = z.object({
  subscriptionId: z.string(),
  outcome: OutcomeSchema,
  preChargeNotificationDueAt: z.coerce.date(),
});

const RetryInput = z.object({
  subscriptionId: z.string(),
  state: StateSchema,
  failureAt: z.coerce.date(),
});

const RetryOutput = z.object({
  subscriptionId: z.string(),
  outcome: OutcomeSchema,
});

function toState(s: z.infer<typeof StateSchema>): SubscriptionState {
  return {
    status: s.status,
    nextRenewalAt: s.nextRenewalAt,
    retryCount: s.retryCount,
    ...(s.lastFailureAt !== undefined ? { lastFailureAt: s.lastFailureAt } : {}),
    mandateRefreshDueAt: s.mandateRefreshDueAt,
    ...(s.totalCapMinor !== undefined ? { totalCapMinor: s.totalCapMinor } : {}),
    consumedMinor: s.consumedMinor,
    ...(s.endAfterCycles !== undefined ? { endAfterCycles: s.endAfterCycles } : {}),
    cyclesCompleted: s.cyclesCompleted,
  };
}

export function registerSubscriptionTools(reg: McpRegistry): void {
  reg.register({
    name: "subscription.preview_renewal",
    description:
      "Decide what happens at this renewal tick: skip / charge_now / mandate_refresh_required / auto_pause. Also returns the 72h pre-charge notification deadline.",
    scope: "subscription:write",
    auditEvent: "subscription.preview_renewal",
    idempotent: true,
    inputSchema: PreviewInput,
    outputSchema: PreviewOutput,
    handler: async (input) => {
      const state = toState(input.state);
      const outcome = evaluateRenewal(state, {
        amountMinor: input.amountMinor,
        now: input.now,
      });
      return {
        subscriptionId: input.subscriptionId,
        outcome,
        preChargeNotificationDueAt: preChargeNotificationDue(state),
      };
    },
  });

  reg.register({
    name: "subscription.plan_retry",
    description:
      "Plan the next retry after a payment failure: schedule_retry (1d/3d/7d ladder) or auto_pause (after 3 attempts or 14d total).",
    scope: "subscription:write",
    auditEvent: "subscription.plan_retry",
    idempotent: true,
    inputSchema: RetryInput,
    outputSchema: RetryOutput,
    handler: async (input) => {
      const state = toState(input.state);
      const outcome = planRetry(state, input.failureAt);
      return {
        subscriptionId: input.subscriptionId,
        outcome,
      };
    },
  });
}
