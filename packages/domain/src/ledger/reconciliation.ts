// Hourly reconciliation per spec §7.3:
//   For every order: Σ(legs) == gross - fees, partitioned by currency.
//   Mismatches halt payouts and page on-call.

import type { LedgerLeg } from "./double-entry.js";

export interface OrderRecon {
  orderId: string;
  grossMinor: bigint;
  feesMinor: bigint;
  currency: string;
  legs: ReadonlyArray<LedgerLeg>;
}

export interface ReconResult {
  orderId: string;
  ok: boolean;
  expectedNetMinor: bigint;
  actualNetMinor: bigint;
  diffMinor: bigint;
  currency: string;
}

export function reconcileOrder(input: OrderRecon): ReconResult {
  const expectedNet = input.grossMinor - input.feesMinor;
  // Net to non-clearing accounts in same currency:
  //   (credits to revenue/seller_payable/tax/affiliate/tip/charity)
  //   - debits to fee_expense (already netted via grossMinor - feesMinor)
  let credits = 0n;
  let debits = 0n;
  for (const l of input.legs) {
    if (l.currency !== input.currency) continue;
    if (l.legType === "gross_charge" || l.legType === "processor_fee") continue;
    if (l.side === "credit") credits += l.amountMinor;
    else debits += l.amountMinor;
  }
  const actualNet = credits - debits;
  return {
    orderId: input.orderId,
    expectedNetMinor: expectedNet,
    actualNetMinor: actualNet,
    diffMinor: actualNet - expectedNet,
    currency: input.currency,
    ok: actualNet === expectedNet,
  };
}

export function shouldHaltPayouts(results: ReadonlyArray<ReconResult>, toleranceMinor = 0n): boolean {
  // A negative tolerance would invert the comparison: `diff < -(-5) = 5` and
  // `diff > -5` together cover [-5, 5] but in the OPPOSITE polarity — the
  // function would HALT payouts for in-tolerance diffs and PASS out-of-
  // tolerance diffs. Caller bug, but the failure mode (silent payout of
  // unreconciled money) is the most expensive kind to discover late.
  if (toleranceMinor < 0n) {
    throw new RangeError(`shouldHaltPayouts:negative_tolerance:${toleranceMinor}`);
  }
  return results.some((r) => !r.ok && (r.diffMinor < -toleranceMinor || r.diffMinor > toleranceMinor));
}
