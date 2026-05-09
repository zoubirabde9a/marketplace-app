// Order tools — apply transitions on the order state machine and query allowed
// next steps. See SOP 05 (seller fulfillment) and SOP 03 (buyer purchase).

import { z } from "zod";
import {
  applyEvent,
  canTransition,
  isTerminal,
  type OrderStatus,
  type OrderEvent,
} from "@marketplace/domain/order/state-machine";
import type { McpRegistry } from "../registry.js";

const StatusEnum = z.enum([
  "created",
  "authorized",
  "paid",
  "fulfilling",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
  "disputed",
]);

const EventInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("authorize") }),
  z.object({ kind: z.literal("capture") }),
  z.object({ kind: z.literal("begin_fulfillment") }),
  z.object({ kind: z.literal("ship") }),
  z.object({ kind: z.literal("deliver") }),
  z.object({ kind: z.literal("cancel"), reason: z.string().min(1) }),
  z.object({ kind: z.literal("refund"), amountMinor: z.bigint() }),
  z.object({ kind: z.literal("open_dispute"), reason: z.string().min(1) }),
]);

const ALL_EVENT_KINDS = [
  "authorize",
  "capture",
  "begin_fulfillment",
  "ship",
  "deliver",
  "cancel",
  "refund",
  "open_dispute",
] as const;

const ApplyInput = z.object({
  orderId: z.string(),
  current: StatusEnum,
  event: EventInput,
});
const ApplyOutput = z.object({
  orderId: z.string(),
  previous: StatusEnum,
  next: StatusEnum,
  terminal: z.boolean(),
});

const ListInput = z.object({
  orderId: z.string(),
  current: StatusEnum,
});
const ListOutput = z.object({
  orderId: z.string(),
  current: StatusEnum,
  allowedEvents: z.array(z.enum(ALL_EVENT_KINDS)),
  terminal: z.boolean(),
});

export function registerOrderTools(reg: McpRegistry): void {
  reg.register({
    name: "order.apply_event",
    description:
      "Apply a transition to an order (authorize / capture / begin_fulfillment / ship / deliver / cancel / refund / open_dispute) against the canonical state machine. Rejects invalid transitions.",
    scope: "order:cancel", // any caller mutating order state needs at least this; finer scopes can layer in the API
    auditEvent: "order.apply_event",
    idempotent: false,
    inputSchema: ApplyInput,
    outputSchema: ApplyOutput,
    handler: async (input) => {
      const next: OrderStatus = applyEvent(input.current, input.event as OrderEvent);
      return {
        orderId: input.orderId,
        previous: input.current,
        next,
        terminal: isTerminal(next),
      };
    },
    errorCatalog: [
      {
        code: "order_invalid_transition",
        httpStatus: 409,
        description: "Requested event is not allowed in the current order state.",
      },
    ],
  });

  reg.register({
    name: "order.allowed_events",
    description:
      "Return the events that are allowed from the current order state. Read-only; useful for an agent that wants to plan its next move without trying transitions blindly.",
    scope: "order:read",
    auditEvent: "order.allowed_events",
    idempotent: true,
    inputSchema: ListInput,
    outputSchema: ListOutput,
    handler: async (input) => {
      const allowed = ALL_EVENT_KINDS.filter((k) => canTransition(input.current, k));
      return {
        orderId: input.orderId,
        current: input.current,
        allowedEvents: allowed,
        terminal: isTerminal(input.current),
      };
    },
  });
}
