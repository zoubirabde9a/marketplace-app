// Refund routing per spec §7.2.
//
// Order: original instrument → linked principal wallet → manual payout → credit-note VDC.

export type RefundRoute =
  | { kind: "original_source"; providerRef: string }
  | { kind: "wallet"; walletId: string }
  | { kind: "manual_payout"; payoutInstructionId: string }
  | { kind: "credit_note_vdc"; vdcId: string };

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
    const providerRef = await resolver.reverseToOriginalSource();
    return { kind: "original_source", providerRef };
  }
  // 2. Wallet — if available and principal hasn't opted out.
  if (ctx.walletAvailable && !ctx.walletOptedOut) {
    const walletId = await resolver.creditWallet();
    return { kind: "wallet", walletId };
  }
  // 3. Manual payout to verified bank account.
  if (ctx.manualPayoutAvailable) {
    const payoutInstructionId = await resolver.enqueueManualPayout();
    return { kind: "manual_payout", payoutInstructionId };
  }
  // 4. Credit note VDC — last resort, redeemable within 7 years.
  const vdcId = await resolver.issueCreditNoteVdc();
  return { kind: "credit_note_vdc", vdcId };
}
