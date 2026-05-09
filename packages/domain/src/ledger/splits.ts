// Multi-party split computation per spec §7.3.
//
// Inputs: gross charge, per-seller subtotals, marketplace fee bps, processor fee, optional
// affiliate bps, optional tip, optional charity. Output: balanced ledger legs.

import { ConflictError } from "@marketplace/shared/errors";
import type { LedgerLeg } from "./double-entry.js";

export interface SellerSplit {
  sellerOrgId: string;
  /** Subtotal less seller-side discounts, before marketplace fee. */
  sellerNetMinor: bigint;
  /** Tax owed by buyer collected on this seller's behalf (marketplace-facilitator). */
  taxMinor: bigint;
}

export interface SplitInputs {
  orderId: string;
  txGroupId: string;
  currency: string;
  /** Total amount the buyer is charged. */
  grossMinor: bigint;
  /** Per-seller breakdown — sum equals subtotal. */
  sellers: SellerSplit[];
  /** Stripe processing fee on the gross. */
  processorFeeMinor: bigint;
  /** Marketplace commission, basis points of seller-net. */
  marketplaceFeeBps: number;
  /** Optional flat affiliate bps of seller-net. */
  affiliateBps?: number;
  affiliateOrgId?: string;
  /** Optional tip going to a single seller (or split evenly if multiple). */
  tipMinor?: bigint;
  /** Optional rounding-up charity donation. */
  charityMinor?: bigint;
}

export interface AccountResolver {
  buyerArAccountId: string;
  stripeClearingAccountId: string;
  feeExpenseAccountId: string;
  platformRevenueAccountId: string;
  taxPayableAccountId: string;
  sellerPayableAccountId(sellerOrgId: string): string;
  affiliatePayableAccountId?(affiliateOrgId: string): string;
  charityAccountId?: string;
  tipAccountId?(sellerOrgId: string): string;
}

export interface ComputedSplit {
  legs: LedgerLeg[];
  perSellerNet: Array<{ sellerOrgId: string; netPayableMinor: bigint; marketplaceFeeMinor: bigint; affiliateMinor: bigint }>;
}

export function computeSplitLegs(input: SplitInputs, resolver: AccountResolver): ComputedSplit {
  if (input.marketplaceFeeBps < 0 || input.marketplaceFeeBps > 10000) {
    throw new ConflictError("split_invalid_marketplace_fee");
  }
  const sumSellerNet = input.sellers.reduce((s, x) => s + x.sellerNetMinor, 0n);
  const sumTax = input.sellers.reduce((s, x) => s + x.taxMinor, 0n);
  const tip = input.tipMinor ?? 0n;
  const charity = input.charityMinor ?? 0n;
  const expectedGross = sumSellerNet + sumTax + tip + charity;
  if (expectedGross !== input.grossMinor) {
    throw new ConflictError(`split_gross_mismatch:${expectedGross}!=${input.grossMinor}`);
  }

  const legs: LedgerLeg[] = [];

  // Buyer is charged: AR Buyer (debit) ↔ Stripe clearing (credit), then we receive funds:
  // Stripe clearing (debit) ↔ AR Buyer (credit) cancels — collapse to single
  //   Stripe clearing DR / each-payable CR, plus Fee Expense DR.

  // 1. Stripe clearing increases by gross
  legs.push({
    accountId: resolver.stripeClearingAccountId,
    side: "debit",
    amountMinor: input.grossMinor,
    currency: input.currency,
    legType: "gross_charge",
    externalRef: input.orderId,
  });

  // 2. Processor fee — debit fee expense, credit stripe clearing (reduces our cash)
  if (input.processorFeeMinor > 0n) {
    legs.push({
      accountId: resolver.feeExpenseAccountId,
      side: "debit",
      amountMinor: input.processorFeeMinor,
      currency: input.currency,
      legType: "processor_fee",
    });
    legs.push({
      accountId: resolver.stripeClearingAccountId,
      side: "credit",
      amountMinor: input.processorFeeMinor,
      currency: input.currency,
      legType: "processor_fee",
    });
  }

  const perSeller: ComputedSplit["perSellerNet"] = [];
  for (const s of input.sellers) {
    const marketplaceFee = (s.sellerNetMinor * BigInt(input.marketplaceFeeBps)) / 10000n;
    const affiliateMinor =
      input.affiliateBps && input.affiliateOrgId
        ? (s.sellerNetMinor * BigInt(input.affiliateBps)) / 10000n
        : 0n;
    const sellerNetPayable = s.sellerNetMinor - marketplaceFee - affiliateMinor;
    perSeller.push({
      sellerOrgId: s.sellerOrgId,
      netPayableMinor: sellerNetPayable,
      marketplaceFeeMinor: marketplaceFee,
      affiliateMinor,
    });

    // Marketplace revenue
    if (marketplaceFee > 0n) {
      legs.push({
        accountId: resolver.platformRevenueAccountId,
        side: "credit",
        amountMinor: marketplaceFee,
        currency: input.currency,
        legType: "marketplace_fee",
      });
    }
    // Affiliate payable
    if (affiliateMinor > 0n) {
      const acct = resolver.affiliatePayableAccountId?.(input.affiliateOrgId!);
      if (!acct) throw new ConflictError("split_affiliate_account_unresolved");
      legs.push({
        accountId: acct,
        side: "credit",
        amountMinor: affiliateMinor,
        currency: input.currency,
        legType: "affiliate",
      });
    }
    // Seller payable
    legs.push({
      accountId: resolver.sellerPayableAccountId(s.sellerOrgId),
      side: "credit",
      amountMinor: sellerNetPayable,
      currency: input.currency,
      legType: "seller_split",
    });
    // Tax sits in our liability account; we are the marketplace-facilitator.
    if (s.taxMinor > 0n) {
      legs.push({
        accountId: resolver.taxPayableAccountId,
        side: "credit",
        amountMinor: s.taxMinor,
        currency: input.currency,
        legType: "tax_remit",
      });
    }
  }

  // Tip & charity: go to designated accounts; if multiple sellers, tip splits evenly.
  if (tip > 0n) {
    if (input.sellers.length === 1 && resolver.tipAccountId) {
      legs.push({
        accountId: resolver.tipAccountId(input.sellers[0]!.sellerOrgId),
        side: "credit",
        amountMinor: tip,
        currency: input.currency,
        legType: "tip",
      });
    } else if (resolver.tipAccountId) {
      const per = tip / BigInt(input.sellers.length);
      const remainder = tip - per * BigInt(input.sellers.length);
      input.sellers.forEach((s, idx) => {
        const amt = idx === 0 ? per + remainder : per;
        legs.push({
          accountId: resolver.tipAccountId!(s.sellerOrgId),
          side: "credit",
          amountMinor: amt,
          currency: input.currency,
          legType: "tip",
        });
      });
    } else {
      throw new ConflictError("split_tip_account_unresolved");
    }
  }
  if (charity > 0n) {
    if (!resolver.charityAccountId) throw new ConflictError("split_charity_account_unresolved");
    legs.push({
      accountId: resolver.charityAccountId,
      side: "credit",
      amountMinor: charity,
      currency: input.currency,
      legType: "charity",
    });
  }

  return { legs, perSellerNet: perSeller };
}
