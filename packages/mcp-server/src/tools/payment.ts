// Payment tools — pre-charge spend-cap + velocity checks for an agent passport.
// Both surface the same errors the checkout path would, but as structured results
// rather than thrown exceptions, so an agent can dry-run a charge before committing.
// See SOP 02 (buyer account setup) and SOP 03 (buyer purchase).

import { z } from "zod";
import { checkSpendCap, checkVelocity } from "@marketplace/domain/identity/spend-caps";
import type { McpRegistry } from "../registry.js";

const Caps = z.object({
  currency: z.string().min(3).max(8),
  perTxMinor: z.bigint().optional(),
  perDayMinor: z.bigint().optional(),
  perMerchantMinor: z.bigint().optional(),
});

const Usage = z.object({
  todayMinor: z.bigint(),
  perMerchantMinor: z.array(z.tuple([z.string(), z.bigint()])).default([]),
});

const SpendCheckInput = z.object({
  passportId: z.string(),
  caps: Caps,
  usage: Usage,
  amountMinor: z.bigint(),
  currency: z.string(),
  merchantId: z.string(),
});

const SpendCheckOutput = z.object({
  passportId: z.string(),
  allowed: z.boolean(),
  reason: z.string().optional(),
});

const Loc = z.object({ lat: z.number(), lng: z.number(), atMs: z.number().int().nonnegative() });

const VelocityInput = z.object({
  passportId: z.string(),
  rolling30dMedianMinor: z.bigint(),
  amountMinor: z.bigint(),
  txLastHour: z.number().int().nonnegative(),
  lastLocation: Loc.optional(),
  currentLocation: Loc.optional(),
});

const VelocityOutput = z.object({
  passportId: z.string(),
  anomaly: z.boolean(),
  reasons: z.array(z.string()),
});

export function registerPaymentTools(reg: McpRegistry): void {
  reg.register({
    name: "payment.check_spend_cap",
    description:
      "Dry-run the spend-cap check that the checkout path enforces (per-tx / per-day / per-merchant). Returns an `allowed` flag with the matching reason rather than throwing — so the caller can tell which cap would fire.",
    scope: "checkout:execute",
    auditEvent: "payment.check_spend_cap",
    idempotent: true,
    inputSchema: SpendCheckInput,
    outputSchema: SpendCheckOutput,
    handler: async (input) => {
      const perMerchant = new Map<string, bigint>(input.usage.perMerchantMinor);
      const caps = {
        currency: input.caps.currency,
        ...(input.caps.perTxMinor !== undefined ? { perTxMinor: input.caps.perTxMinor } : {}),
        ...(input.caps.perDayMinor !== undefined ? { perDayMinor: input.caps.perDayMinor } : {}),
        ...(input.caps.perMerchantMinor !== undefined ? { perMerchantMinor: input.caps.perMerchantMinor } : {}),
      };
      try {
        checkSpendCap({
          caps,
          usage: { todayMinor: input.usage.todayMinor, perMerchantMinor: perMerchant },
          amountMinor: input.amountMinor,
          currency: input.currency,
          merchantId: input.merchantId,
        });
        return { passportId: input.passportId, allowed: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { passportId: input.passportId, allowed: false, reason: msg };
      }
    },
  });

  reg.register({
    name: "payment.check_velocity",
    description:
      "Score this charge against rolling-30d-median, tx/hour, and geo-jump signals. Returns `anomaly` + reason list so callers can decide whether to step up auth.",
    scope: "checkout:execute",
    auditEvent: "payment.check_velocity",
    idempotent: true,
    inputSchema: VelocityInput,
    outputSchema: VelocityOutput,
    handler: async (input) => {
      const sig = checkVelocity({
        rolling30dMedianMinor: input.rolling30dMedianMinor,
        amountMinor: input.amountMinor,
        txLastHour: input.txLastHour,
        ...(input.lastLocation ? { lastLocation: input.lastLocation } : {}),
        ...(input.currentLocation ? { currentLocation: input.currentLocation } : {}),
      });
      return { passportId: input.passportId, anomaly: sig.anomaly, reasons: sig.reasons };
    },
  });
}
