import { describe, expect, it } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { computeReputation, signReputationExport } from "../src/negotiation/reputation.js";
import { scanForCollusion } from "../src/negotiation/anti-collusion.js";

describe("computeReputation", () => {
  it("flags insufficient data below 10 tx or 30 days", () => {
    const r = computeReputation(
      {
        settledTxCount: 5,
        settledValueMinor: 1000n,
        disputesAgainst: 0,
        chargebackRateBps: 0,
        refundRateBps: 0,
        cancellationRateBps: 0,
        counterpartyAvgBps: 9000,
        daysOfHistory: 60,
      },
      new Date("2026-05-03"),
      new Date("2026-05-01"),
    );
    expect(r.insufficientData).toBe(true);
  });

  it("rewards clean track record", () => {
    const r = computeReputation(
      {
        settledTxCount: 200,
        settledValueMinor: 1_000_000n,
        disputesAgainst: 0,
        chargebackRateBps: 0,
        refundRateBps: 50,
        cancellationRateBps: 50,
        counterpartyAvgBps: 9500,
        daysOfHistory: 365,
      },
      new Date("2026-05-03"),
      new Date("2026-05-02"),
    );
    expect(r.scoreBps).toBeGreaterThan(8000);
  });

  it("penalizes disputes", () => {
    const r = computeReputation(
      {
        settledTxCount: 200,
        settledValueMinor: 1_000_000n,
        disputesAgainst: 30,
        chargebackRateBps: 200,
        refundRateBps: 1000,
        cancellationRateBps: 1000,
        counterpartyAvgBps: 4000,
        daysOfHistory: 365,
      },
      new Date("2026-05-03"),
      new Date("2026-05-02"),
    );
    expect(r.scoreBps).toBeLessThan(6500);
  });

  it("decays inactive reputation", () => {
    const fresh = computeReputation(
      {
        settledTxCount: 200,
        settledValueMinor: 1_000_000n,
        disputesAgainst: 0,
        chargebackRateBps: 0,
        refundRateBps: 0,
        cancellationRateBps: 0,
        counterpartyAvgBps: 9000,
        daysOfHistory: 365,
      },
      new Date("2026-05-03"),
      new Date("2026-05-02"),
    );
    const stale = computeReputation(
      {
        settledTxCount: 200,
        settledValueMinor: 1_000_000n,
        disputesAgainst: 0,
        chargebackRateBps: 0,
        refundRateBps: 0,
        cancellationRateBps: 0,
        counterpartyAvgBps: 9000,
        daysOfHistory: 365,
      },
      new Date("2026-05-03"),
      new Date("2025-05-03"), // 365 days ago — ~16 half-lives → ~6% of fresh
    );
    expect(stale.scoreBps).toBeLessThan(fresh.scoreBps / 2);
  });
});

describe("signReputationExport", () => {
  it("produces a verifiable JWT", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const out = signReputationExport(
      {
        agentId: "agt_1",
        marketplaceId: "marketplace.dev",
        scoreBps: 8500,
        components: {
          settledTxCount: 100,
          settledValueMinor: 100n,
          disputesAgainst: 0,
          chargebackRateBps: 0,
          refundRateBps: 0,
          cancellationRateBps: 0,
          counterpartyAvgBps: 9000,
          daysOfHistory: 90,
        },
        period: { from: "2026-02", to: "2026-05" },
        expiresAt: 1_800_000_000,
        iat: 1_700_000_000,
      },
      privateKey,
      "kid-1",
    );
    const [h, p, s] = out.vdc.split(".");
    const ok = verify(
      null,
      Buffer.from(`${h}.${p}`),
      publicKey,
      Buffer.from(s!.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
    );
    expect(ok).toBe(true);
  });
});

describe("scanForCollusion", () => {
  const now = new Date(60_000);

  it("flags rate-limit excess for one (buyer, seller, sku)", () => {
    const events = Array.from({ length: 35 }, (_, i) => ({
      buyerOrgId: "b1",
      sellerOrgId: "s1",
      variantId: "v1",
      proposedUnitPriceMinor: 100n,
      at: new Date(i * 100),
    }));
    const findings = scanForCollusion(events, now);
    expect(findings.find((f) => f.signal === "rate_limit_exceeded")).toBeTruthy();
  });

  it("flags identical sequences across distinct buyers", () => {
    const events = [
      { buyerOrgId: "b1", sellerOrgId: "s1", variantId: "v1", proposedUnitPriceMinor: 100n, at: new Date(1) },
      { buyerOrgId: "b1", sellerOrgId: "s1", variantId: "v1", proposedUnitPriceMinor: 90n, at: new Date(2) },
      { buyerOrgId: "b2", sellerOrgId: "s1", variantId: "v1", proposedUnitPriceMinor: 100n, at: new Date(3) },
      { buyerOrgId: "b2", sellerOrgId: "s1", variantId: "v1", proposedUnitPriceMinor: 90n, at: new Date(4) },
    ];
    const findings = scanForCollusion(events, now);
    expect(findings.find((f) => f.signal === "identical_sequence")).toBeTruthy();
  });
});
