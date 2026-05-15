// Append-only double-entry ledger primitives. Spec §7.3.
// Every business transaction posts a balanced multi-leg entry; this module enforces
// `Σ debits == Σ credits` per currency before persistence.

import { ConflictError } from "@marketplace/shared/errors";

export type LedgerSide = "debit" | "credit";

export interface LedgerLeg {
  accountId: string;
  side: LedgerSide;
  amountMinor: bigint;
  currency: string;
  legType: string;
  externalRef?: string;
}

export interface PostEntry {
  txGroupId: string; // groups all legs of a single business transaction
  orderId?: string;
  postedAt: Date;
  legs: LedgerLeg[];
}

// Hard upper bound on legs in a single entry. A real entry has at most a
// dozen legs (gross + processor + per-seller × N + tip + charity + tax
// per currency); 1000 is generous headroom while bounding the
// O(legs) balance check + the DB INSERT batch. An unbounded legs array
// would let a misbehaving saga step submit a multi-MB entry that the
// reconciliation job then has to walk every hour.
const MAX_LEGS_PER_ENTRY = 1000;

export function assertBalanced(legs: ReadonlyArray<LedgerLeg>): void {
  if (legs.length < 2) {
    throw new ConflictError("ledger_min_two_legs");
  }
  if (legs.length > MAX_LEGS_PER_ENTRY) {
    throw new ConflictError(`ledger_too_many_legs:${legs.length}`);
  }
  const totals = new Map<string, { debit: bigint; credit: bigint }>();
  for (const l of legs) {
    if (l.amountMinor < 0n) throw new ConflictError("ledger_negative_amount");
    // A 0-amount leg adds nothing to the balance check but signals a bug
    // upstream — a calculation produced 0 and shouldn't have made it to
    // the ledger. Reject so the upstream bug is visible at write time
    // rather than silently swallowed by a no-op row sitting in the
    // audit trail forever.
    if (l.amountMinor === 0n) throw new ConflictError("ledger_zero_amount_leg");
    // Currency must be ISO-4217-shaped (3 uppercase letters). Mixed
    // casing (`"USD"` vs `"usd"`) keys the Map separately and silently
    // lets an asymmetric entry pass — credits in "USD" against debits
    // in "usd" each sum to zero per Map key, so the balance invariant
    // appears to hold even though the books are wrong.
    if (!/^[A-Z]{3}$/.test(l.currency)) {
      throw new ConflictError(`ledger_invalid_currency:${l.currency}`);
    }
    const t = totals.get(l.currency) ?? { debit: 0n, credit: 0n };
    if (l.side === "debit") t.debit += l.amountMinor;
    else t.credit += l.amountMinor;
    totals.set(l.currency, t);
  }
  for (const [currency, t] of totals.entries()) {
    if (t.debit !== t.credit) {
      throw new ConflictError(
        `ledger_unbalanced:${currency}:debit=${t.debit},credit=${t.credit}`,
      );
    }
  }
}

export interface AccountSpec {
  accountId: string;
  kind: AccountKind;
  ownerOrgId?: string;
  ownerUserId?: string;
  currency: string;
}

export type AccountKind =
  | "platform_revenue"
  | "tax_payable"
  | "seller_payable"
  | "buyer_wallet"
  | "stripe_clearing"
  | "charity"
  | "tip"
  | "affiliate_payable"
  | "fee_expense"
  | "ar_buyer";

export const NORMAL_SIDE: Record<AccountKind, LedgerSide> = {
  platform_revenue: "credit",
  tax_payable: "credit",
  seller_payable: "credit",
  buyer_wallet: "credit",
  stripe_clearing: "debit",
  charity: "credit",
  tip: "credit",
  affiliate_payable: "credit",
  fee_expense: "debit",
  ar_buyer: "debit",
};
