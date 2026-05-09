import { describe, expect, it } from "vitest";
import { McpRegistry, type McpContext } from "../src/registry.js";
import { registerRefundTools } from "../src/tools/refund.js";

function ctx(scopes: string[]): McpContext {
  return {
    agentId: "agt_1",
    passportId: "psp_1",
    scopes: new Set(scopes),
    ownerKind: "user",
    ownerId: "usr_1",
    requestId: "req_1",
    now: () => 0,
    emitAudit: async () => {},
  };
}

const reg = (): McpRegistry => {
  const r = new McpRegistry();
  registerRefundTools(r);
  return r;
};

const baseInput = (overrides: Partial<{
  originalSourceRecreditable: boolean;
  walletAvailable: boolean;
  walletOptedOut: boolean;
  manualPayoutAvailable: boolean;
}> = {}) => ({
  refundId: "ref_1",
  amountMinor: 5699n,
  currency: "USD",
  ctx: {
    instrumentKind: "card" as const,
    originalSourceRecreditable: true,
    walletAvailable: false,
    walletOptedOut: false,
    manualPayoutAvailable: false,
    ...overrides,
  },
});

const invoke = (input: unknown) =>
  reg().invoke("refund.preview_route", input, ctx(["return:write"]));

describe("refund.preview_route — waterfall ordering", () => {
  it("picks original_source when recreditable", async () => {
    const out = (await invoke(baseInput())) as { routeKind: string; rejectedRoutes: unknown[] };
    expect(out.routeKind).toBe("original_source");
    expect(out.rejectedRoutes).toEqual([]);
  });

  it("falls through to wallet when original is not recreditable", async () => {
    const out = (await invoke(
      baseInput({ originalSourceRecreditable: false, walletAvailable: true }),
    )) as { routeKind: string; rejectedRoutes: Array<{ kind: string; reason: string }> };
    expect(out.routeKind).toBe("wallet");
    expect(out.rejectedRoutes).toEqual([
      { kind: "original_source", reason: "original_source_not_recreditable" },
    ]);
  });

  it("respects walletOptedOut even when wallet is available", async () => {
    const out = (await invoke(
      baseInput({
        originalSourceRecreditable: false,
        walletAvailable: true,
        walletOptedOut: true,
        manualPayoutAvailable: true,
      }),
    )) as { routeKind: string; rejectedRoutes: Array<{ reason: string }> };
    expect(out.routeKind).toBe("manual_payout");
    expect(out.rejectedRoutes.map((r) => r.reason)).toEqual([
      "original_source_not_recreditable",
      "wallet_opted_out",
    ]);
  });

  it("falls through to manual_payout when wallet unavailable", async () => {
    const out = (await invoke(
      baseInput({ originalSourceRecreditable: false, manualPayoutAvailable: true }),
    )) as { routeKind: string; rejectedRoutes: Array<{ reason: string }> };
    expect(out.routeKind).toBe("manual_payout");
    expect(out.rejectedRoutes.map((r) => r.reason)).toEqual([
      "original_source_not_recreditable",
      "wallet_unavailable",
    ]);
  });

  it("issues credit_note_vdc when nothing else applies (last resort)", async () => {
    const out = (await invoke(baseInput({ originalSourceRecreditable: false }))) as {
      routeKind: string;
      rejectedRoutes: Array<{ reason: string }>;
    };
    expect(out.routeKind).toBe("credit_note_vdc");
    expect(out.rejectedRoutes.map((r) => r.reason)).toEqual([
      "original_source_not_recreditable",
      "wallet_unavailable",
      "manual_payout_unavailable",
    ]);
  });

  it("echoes refundId, amount, and currency for caller correlation", async () => {
    const out = (await invoke(baseInput())) as { refundId: string; amountMinor: bigint; currency: string };
    expect(out.refundId).toBe("ref_1");
    expect(out.amountMinor).toBe(5699n);
    expect(out.currency).toBe("USD");
  });

  it("denies invocation without return:write scope", async () => {
    const r = reg();
    await expect(
      r.invoke("refund.preview_route", baseInput(), ctx([])),
    ).rejects.toThrow(/missing_scope:return:write/);
  });

  it("rejects unknown instrumentKind", async () => {
    await expect(
      invoke({ ...baseInput(), ctx: { ...baseInput().ctx, instrumentKind: "crypto-bonds" } }),
    ).rejects.toThrow();
  });
});
