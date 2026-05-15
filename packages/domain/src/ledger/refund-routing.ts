// Refund routing per spec §7.2.
//
// Order: original instrument → linked principal wallet → manual payout → credit-note VDC.

import { MarketplaceError } from "@marketplace/shared/errors";

export type RefundRoute =
  | { kind: "original_source"; providerRef: string }
  | { kind: "wallet"; walletId: string }
  | { kind: "manual_payout"; payoutInstructionId: string }
  | { kind: "credit_note_vdc"; vdcId: string };

// A resolver returning an empty / non-string reference would let us construct
// a "successful" RefundRoute that downstream reconciliation can't actually
// look up — the refund would appear in the ledger but have no provider-side
// counterpart to verify against. Catch this at the source so the failure mode
// is loud rather than silently broken-after-the-fact.
function requireRef(ref: unknown, route: string): string {
  if (typeof ref !== "string" || ref.length === 0) {
    throw new MarketplaceError({
      type: "https://marketplace.dev/errors/refund-resolver-empty-ref",
      title: "refund_resolver_returned_empty_ref",
      status: 502,
      detail: route,
    });
  }
  return ref;
}

export interface RefundContext {
  instrumentKind: "card" | "bank" | "wallet" | "virtual_card" | "stablecoin";
  /** Original-source still recreditable per Stripe's introspection. */
  originalSourceRecreditable: boolean;
  /** Principal has a stored-value wallet in the same currency. */
  walletAvailable: boolean;
  /** Principal opted out of wallet credit (e.g. wants cash to a verified bank). */
  walletOptedOut: boolean;
  /** Principal has a verified payout target (Plaid-linked bank, etc.). */
  manualPayoutAvailable: boolean;
}

export interface RouteResolver {
  /** Returns provider-specific reversal reference for the original instrument. */
  reverseToOriginalSource: () => Promise<string>;
  creditWallet: () => Promise<string>;
  enqueueManualPayout: () => Promise<string>;
  issueCreditNoteVdc: () => Promise<string>;
}

export async function routeRefund(
  ctx: RefundContext,
  resolver: RouteResolver,
): Promise<RefundRoute> {
  // 1. Original instrument first — works for ~95% of cases per spec.
  if (ctx.originalSourceRecreditable) {
    const providerRef = requireRef(
      await resolver.reverseToOriginalSource(),
      "original_source",
    );
    return { kind: "original_source", providerRef };
  }
  // 2. Wallet — if available and principal hasn't opted out.
  if (ctx.walletAvailable && !ctx.walletOptedOut) {
    const walletId = requireRef(await resolver.creditWallet(), "wallet");
    return { kind: "wallet", walletId };
  }
  // 3. Manual payout to verified bank account.
  if (ctx.manualPayoutAvailable) {
    const payoutInstructionId = requireRef(
      await resolver.enqueueManualPayout(),
      "manual_payout",
    );
    return { kind: "manual_payout", payoutInstructionId };
  }
  // 4. Credit note VDC — last resort, redeemable within 7 years.
  const vdcId = requireRef(await resolver.issueCreditNoteVdc(), "credit_note_vdc");
  return { kind: "credit_note_vdc", vdcId };
}
