import { describe, expect, it } from "vitest";
import { assertBalanced, type LedgerLeg } from "../src/ledger/double-entry.js";
import { computeSplitLegs, type AccountResolver } from "../src/ledger/splits.js";
import { reconcileOrder, shouldHaltPayouts } from "../src/ledger/reconciliation.js";
import { routeRefund, type RefundContext, type RouteResolver } from "../src/ledger/refund-routing.js";
import { Saga, type SagaState, type SagaStep } from "../src/ledger/saga.js";

describe("assertBalanced", () => {
  it("accepts balanced two-leg entry", () => {
    expect(() =>
      assertBalanced([
        { accountId: "a", side: "debit", amountMinor: 100n, currency: "USD", legType: "x" },
        { accountId: "b", side: "credit", amountMinor: 100n, currency: "USD", legType: "x" },
      ]),
    ).not.toThrow();
  });

  it("rejects unbalanced entry", () => {
    expect(() =>
      assertBalanced([
        { accountId: "a", side: "debit", amountMinor: 100n, currency: "USD", legType: "x" },
        { accountId: "b", side: "credit", amountMinor: 90n, currency: "USD", legType: "x" },
      ]),
    ).toThrow(/unbalanced/);
  });

  it("balances per-currency independently", () => {
    expect(() =>
      assertBalanced([
        { accountId: "a", side: "debit", amountMinor: 100n, currency: "USD", legType: "x" },
        { accountId: "b", side: "credit", amountMinor: 100n, currency: "USD", legType: "x" },
        { accountId: "c", side: "debit", amountMinor: 50n, currency: "EUR", legType: "y" },
        { accountId: "d", side: "credit", amountMinor: 50n, currency: "EUR", legType: "y" },
      ]),
    ).not.toThrow();
  });

  it("rejects negative amounts", () => {
    expect(() =>
      assertBalanced([
        { accountId: "a", side: "debit", amountMinor: -1n, currency: "USD", legType: "x" },
      ]),
    ).toThrow();
  });
});

const resolver: AccountResolver = {
  buyerArAccountId: "ar",
  stripeClearingAccountId: "stripe",
  feeExpenseAccountId: "fee",
  platformRevenueAccountId: "rev",
  taxPayableAccountId: "tax",
  sellerPayableAccountId: (id) => `s:${id}`,
  affiliatePayableAccountId: (id) => `aff:${id}`,
  charityAccountId: "charity",
  tipAccountId: (id) => `tip:${id}`,
};

describe("computeSplitLegs", () => {
  it("produces balanced legs for single-seller order", () => {
    const r = computeSplitLegs(
      {
        orderId: "o1",
        txGroupId: "tx1",
        currency: "USD",
        grossMinor: 110_00n,
        sellers: [{ sellerOrgId: "s1", sellerNetMinor: 100_00n, taxMinor: 10_00n }],
        processorFeeMinor: 3_30n,
        marketplaceFeeBps: 1500, // 15%
      },
      resolver,
    );
    assertBalanced(r.legs);
    expect(r.perSellerNet[0]?.marketplaceFeeMinor).toBe(15_00n);
    expect(r.perSellerNet[0]?.netPayableMinor).toBe(85_00n);
  });

  it("supports affiliate split", () => {
    const r = computeSplitLegs(
      {
        orderId: "o2",
        txGroupId: "tx2",
        currency: "USD",
        grossMinor: 100_00n,
        sellers: [{ sellerOrgId: "s1", sellerNetMinor: 100_00n, taxMinor: 0n }],
        processorFeeMinor: 0n,
        marketplaceFeeBps: 1000, // 10%
        affiliateBps: 500, // 5%
        affiliateOrgId: "a1",
      },
      resolver,
    );
    assertBalanced(r.legs);
    expect(r.perSellerNet[0]?.affiliateMinor).toBe(5_00n);
    expect(r.perSellerNet[0]?.netPayableMinor).toBe(85_00n);
  });

  it("rejects gross mismatch", () => {
    expect(() =>
      computeSplitLegs(
        {
          orderId: "o",
          txGroupId: "tx",
          currency: "USD",
          grossMinor: 100_00n,
          sellers: [{ sellerOrgId: "s", sellerNetMinor: 50_00n, taxMinor: 0n }], // sums to 50, not 100
          processorFeeMinor: 0n,
          marketplaceFeeBps: 0,
        },
        resolver,
      ),
    ).toThrow(/gross_mismatch/);
  });

  it("multi-seller marketplace tax + tip + charity all balance", () => {
    const r = computeSplitLegs(
      {
        orderId: "o3",
        txGroupId: "tx3",
        currency: "USD",
        grossMinor: 250_00n,
        sellers: [
          { sellerOrgId: "s1", sellerNetMinor: 100_00n, taxMinor: 8_00n },
          { sellerOrgId: "s2", sellerNetMinor: 130_00n, taxMinor: 10_00n },
        ],
        processorFeeMinor: 7_50n,
        marketplaceFeeBps: 1000,
        tipMinor: 1_00n,
        charityMinor: 1_00n,
      },
      resolver,
    );
    assertBalanced(r.legs);
  });
});

describe("reconcileOrder", () => {
  const legs: LedgerLeg[] = [
    { accountId: "stripe", side: "debit", amountMinor: 110_00n, currency: "USD", legType: "gross_charge" },
    { accountId: "fee", side: "debit", amountMinor: 3_30n, currency: "USD", legType: "processor_fee" },
    { accountId: "stripe", side: "credit", amountMinor: 3_30n, currency: "USD", legType: "processor_fee" },
    { accountId: "rev", side: "credit", amountMinor: 15_00n, currency: "USD", legType: "marketplace_fee" },
    { accountId: "s:s1", side: "credit", amountMinor: 85_00n, currency: "USD", legType: "seller_split" },
    { accountId: "tax", side: "credit", amountMinor: 10_00n, currency: "USD", legType: "tax_remit" },
  ];

  it("reports balanced order", () => {
    const r = reconcileOrder({ orderId: "o1", grossMinor: 110_00n, feesMinor: 0n, currency: "USD", legs });
    expect(r.ok).toBe(true);
    expect(r.diffMinor).toBe(0n);
  });

  it("flags discrepancy", () => {
    const broken = legs.slice(0, -1).concat([
      { accountId: "tax", side: "credit", amountMinor: 9_00n, currency: "USD", legType: "tax_remit" },
    ]);
    const r = reconcileOrder({ orderId: "o2", grossMinor: 110_00n, feesMinor: 0n, currency: "USD", legs: broken });
    expect(r.ok).toBe(false);
    expect(shouldHaltPayouts([r])).toBe(true);
  });
});

describe("routeRefund", () => {
  const baseCtx: RefundContext = {
    instrumentKind: "card",
    originalSourceRecreditable: true,
    walletAvailable: true,
    walletOptedOut: false,
    manualPayoutAvailable: true,
  };
  const resolver: RouteResolver = {
    reverseToOriginalSource: async () => "src_ref",
    creditWallet: async () => "wal_ref",
    enqueueManualPayout: async () => "pay_ref",
    issueCreditNoteVdc: async () => "cn_ref",
  };

  it("uses original source first when available", async () => {
    const r = await routeRefund(baseCtx, resolver);
    expect(r.kind).toBe("original_source");
  });

  it("falls back to wallet when original source dead", async () => {
    const r = await routeRefund({ ...baseCtx, originalSourceRecreditable: false }, resolver);
    expect(r.kind).toBe("wallet");
  });

  it("falls back to manual payout when wallet opted out", async () => {
    const r = await routeRefund(
      { ...baseCtx, originalSourceRecreditable: false, walletOptedOut: true },
      resolver,
    );
    expect(r.kind).toBe("manual_payout");
  });

  it("issues credit note as last resort", async () => {
    const r = await routeRefund(
      {
        ...baseCtx,
        originalSourceRecreditable: false,
        walletAvailable: false,
        manualPayoutAvailable: false,
      },
      resolver,
    );
    expect(r.kind).toBe("credit_note_vdc");
  });
});

describe("Saga", () => {
  it("compensates completed steps when later step fails", async () => {
    const log: string[] = [];
    type S = { v: number };
    const steps: SagaStep<S>[] = [
      {
        name: "a",
        execute: async (s) => { log.push("a-exec"); return { v: s.v + 1 }; },
        compensate: async (s) => { log.push("a-comp"); return { v: s.v - 1 }; },
      },
      {
        name: "b",
        execute: async () => { log.push("b-exec-fail"); throw new Error("boom"); },
        compensate: async (s) => { log.push("b-comp"); return s; },
      },
    ];
    const saga = new Saga<S>(steps, { maxAttempts: 1, onPersist: async () => undefined });
    const initial: SagaState<S> = { id: "1", status: "pending", step: "", attempts: 0, state: { v: 0 } };
    const out = await saga.run(initial);
    expect(out.status).toBe("failed");
    expect(log).toEqual(["a-exec", "b-exec-fail", "a-comp"]);
  });

  it("retries up to maxAttempts before compensating", async () => {
    let attempts = 0;
    type S = Record<string, never>;
    const steps: SagaStep<S>[] = [
      {
        name: "x",
        execute: async () => {
          attempts++;
          if (attempts < 3) throw new Error("transient");
          return {} as S;
        },
        compensate: async (s) => s,
      },
    ];
    const saga = new Saga<S>(steps, { maxAttempts: 3, onPersist: async () => undefined });
    const out = await saga.run({ id: "1", status: "pending", step: "", attempts: 0, state: {} });
    expect(out.status).toBe("completed");
    expect(attempts).toBe(3);
  });
});
