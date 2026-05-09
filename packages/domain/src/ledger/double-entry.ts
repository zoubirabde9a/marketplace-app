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

export function assertBalanced(legs: ReadonlyArray<LedgerLeg>): void {
  if (legs.length < 2) {
    throw new ConflictError("ledger_min_two_legs");
  }
  const totals = new Map<string, { debit: bigint; credit: bigint }>();
  for (const l of legs) {
    if (l.amountMinor < 0n) throw new ConflictError("ledger_negative_amount");
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
