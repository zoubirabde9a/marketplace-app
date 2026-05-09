import { describe, expect, it } from "vitest";
import { McpRegistry, type McpContext } from "../src/registry.js";
import { registerPaymentTools } from "../src/tools/payment.js";

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
  registerPaymentTools(r);
  return r;
};

const checkCap = (input: unknown) =>
  reg().invoke("payment.check_spend_cap", input, ctx(["checkout:execute"]));
const checkVel = (input: unknown) =>
  reg().invoke("payment.check_velocity", input, ctx(["checkout:execute"]));

const baseCaps = { currency: "USD", perTxMinor: 50000n, perDayMinor: 200000n, perMerchantMinor: 100000n };
const baseUsage = { todayMinor: 0n, perMerchantMinor: [] as Array<[string, bigint]> };

describe("payment.check_spend_cap", () => {
  it("allows a charge inside every cap", async () => {
    const out = (await checkCap({
      passportId: "psp_buyer",
      caps: baseCaps,
      usage: baseUsage,
      amountMinor: 5000n,
      currency: "USD",
      merchantId: "org_acme",
    })) as { allowed: boolean };
    expect(out.allowed).toBe(true);
  });

  it("rejects with currency_mismatch when caps and charge currencies differ", async () => {
    const out = (await checkCap({
      passportId: "psp_buyer",
      caps: { ...baseCaps, currency: "USD" },
      usage: baseUsage,
      amountMinor: 5000n,
      currency: "EUR",
      merchantId: "org_acme",
    })) as { allowed: boolean; reason: string };
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/spend_cap_currency_mismatch:USD!=EUR/);
  });

  it("rejects per-tx cap with the cap value in the reason", async () => {
    const out = (await checkCap({
      passportId: "psp_buyer",
      caps: { ...baseCaps, perTxMinor: 3000n },
      usage: baseUsage,
      amountMinor: 5000n,
      currency: "USD",
      merchantId: "org_acme",
    })) as { allowed: boolean; reason: string };
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/spend_cap_per_tx_exceeded:5000>3000/);
  });

  it("rejects per-day cap when today's spend + amount exceeds limit", async () => {
    const out = (await checkCap({
      passportId: "psp_buyer",
      caps: baseCaps,
      usage: { todayMinor: 199_500n, perMerchantMinor: [] },
      amountMinor: 1000n,
      currency: "USD",
      merchantId: "org_acme",
    })) as { allowed: boolean; reason: string };
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/spend_cap_per_day_exceeded:200500>200000/);
  });

  it("rejects per-merchant cap for the matching merchant only", async () => {
    const out = (await checkCap({
      passportId: "psp_buyer",
      caps: baseCaps,
      usage: { todayMinor: 0n, perMerchantMinor: [["org_acme", 99_500n]] },
      amountMinor: 1000n,
      currency: "USD",
      merchantId: "org_acme",
    })) as { allowed: boolean; reason: string };
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/spend_cap_per_merchant_exceeded:100500>100000/);
  });

  it("does not blame a different merchant's spend on the current charge", async () => {
    const out = (await checkCap({
      passportId: "psp_buyer",
      caps: baseCaps,
      usage: { todayMinor: 0n, perMerchantMinor: [["org_other", 99_500n]] },
      amountMinor: 1000n,
      currency: "USD",
      merchantId: "org_acme",
    })) as { allowed: boolean };
    expect(out.allowed).toBe(true);
  });
});

describe("payment.check_velocity", () => {
  it("flags amount > 3× rolling 30d median", async () => {
    const out = (await checkVel({
      passportId: "psp_buyer",
      rolling30dMedianMinor: 1000n,
      amountMinor: 4000n,
      txLastHour: 0,
    })) as { anomaly: boolean; reasons: string[] };
    expect(out.anomaly).toBe(true);
    expect(out.reasons).toContain("amount_3x_median");
  });

  it("flags more than 10 transactions in the last hour", async () => {
    const out = (await checkVel({
      passportId: "psp_buyer",
      rolling30dMedianMinor: 1000n,
      amountMinor: 100n,
      txLastHour: 11,
    })) as { anomaly: boolean; reasons: string[] };
    expect(out.anomaly).toBe(true);
    expect(out.reasons).toContain("tx_velocity_10x_per_hour");
  });

  it("flags geo-jump > 1000km in under 1h", async () => {
    const t = 1_700_000_000_000;
    const out = (await checkVel({
      passportId: "psp_buyer",
      rolling30dMedianMinor: 1000n,
      amountMinor: 100n,
      txLastHour: 0,
      lastLocation: { lat: 40.7, lng: -74.0, atMs: t },
      currentLocation: { lat: 51.5, lng: -0.1, atMs: t + 30 * 60 * 1000 }, // 30 min later
    })) as { anomaly: boolean; reasons: string[] };
    expect(out.anomaly).toBe(true);
    expect(out.reasons).toContain("geo_jump_1000km_under_1h");
  });

  it("clean signals → no anomaly", async () => {
    const out = (await checkVel({
      passportId: "psp_buyer",
      rolling30dMedianMinor: 1000n,
      amountMinor: 1500n,
      txLastHour: 2,
    })) as { anomaly: boolean; reasons: string[] };
    expect(out.anomaly).toBe(false);
    expect(out.reasons).toEqual([]);
  });
});

describe("payment tools — scope enforcement", () => {
  it("denies invocation without checkout:execute scope", async () => {
    const r = reg();
    await expect(
      r.invoke(
        "payment.check_spend_cap",
        {
          passportId: "psp_buyer",
          caps: baseCaps,
          usage: baseUsage,
          amountMinor: 100n,
          currency: "USD",
          merchantId: "org_acme",
        },
        ctx([]),
      ),
    ).rejects.toThrow(/missing_scope:checkout:execute/);
  });
});
