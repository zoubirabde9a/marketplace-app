// Payment tools — pre-charge spend-cap + velocity checks for an agent passport.
// Both surface the same errors the checkout path would, but as structured results
// rather than thrown exceptions, so an agent can dry-run a charge before committing.
// See SOP 02 (buyer account setup) and SOP 03 (buyer purchase).

import { z } from "zod";
import { checkSpendCap, checkVelocity } from "@marketplace/domain/identity/spend-caps";
import type { McpRegistry } from "../registry.js";

// ISO 4217 alpha-3 — same allow-list every money-bearing surface uses
// (refund.ts pass #94, catalog/types.ts, checkout, ledger). Pre-fix the
// 3–8 char range admitted lowercase / mixed-case variants that the
// spend-cap check would carry through as currency keys, fragmenting the
// per-currency cap table. Reserve future-extension to a deliberate schema
// change rather than a regex hole.
const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);

// Money amounts and usage counts are always non-negative; the cap fields are
// likewise non-negative (a "cap of 0" would mean "no spend allowed").
const NonNegMinor = z.bigint().nonnegative();
const PositiveMinor = z.bigint().positive();

const Caps = z.object({
  currency: CurrencyCode,
  perTxMinor: NonNegMinor.optional(),
  perDayMinor: NonNegMinor.optional(),
  perMerchantMinor: NonNegMinor.optional(),
});

const Usage = z.object({
  todayMinor: NonNegMinor,
  // Cap the per-merchant-usage array. Pre-fix a caller could ship 1M
  // entries and force the handler to materialise that into a Map. 1000
  // distinct merchants in a buyer's rolling-24h window is already a
  // wildly-improbable usage profile.
  perMerchantMinor: z
    .array(z.tuple([z.string().min(1).max(120), NonNegMinor]))
    .max(1000)
    .default([]),
});

const SpendCheckInput = z.object({
  // Bound ids at the gate. Passport ids are ULIDs/UUIDs (≤64 chars) and
  // merchant ids are seller-org slugs (≤120 chars). Pre-fix both accepted
  // any string, including multi-MB payloads that would balloon the audit
  // row downstream.
  passportId: z.string().min(1).max(120),
  caps: Caps,
  usage: Usage,
  // Strictly positive — a `0n` dry-run trivially clears every cap and would
  // mislead an agent into thinking the real charge is safe.
  amountMinor: PositiveMinor,
  currency: CurrencyCode,
  merchantId: z.string().min(1).max(120),
});

const SpendCheckOutput = z.object({
  passportId: z.string(),
  allowed: z.boolean(),
  reason: z.string().optional(),
});

const Loc = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // Upper-bound the timestamp to ~year 5138 (10^14 ms ≈ 3170 years past
  // epoch — well past any realistic value while still well inside the safe
  // integer range). Pre-fix `Number.MAX_SAFE_INTEGER` was accepted; the
  // geo-jump check then computed `Math.abs(curr.atMs - last.atMs)` over
  // ~10^15 ms and divided distance by that, making any anomaly check
  // numerically meaningless (geo-jump speed → ~0 km/h, never flagged).
  atMs: z.number().int().nonnegative().max(100_000_000_000_000),
});

const VelocityInput = z.object({
  passportId: z.string().min(1).max(120),
  rolling30dMedianMinor: NonNegMinor,
  // Strictly positive — same rationale as SpendCheckInput.amountMinor.
  amountMinor: PositiveMinor,
  // Cap at 10000 tx/hour. Without an upper bound, a caller passing
  // `Number.MAX_SAFE_INTEGER` makes the burst-detector trivially flag
  // every charge; conversely an agent could shave anomaly noise by
  // claiming an implausibly-low value. 10k is well beyond any human
  // buyer's hour but still inside detector-resolution.
  txLastHour: z.number().int().nonnegative().max(10_000),
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
