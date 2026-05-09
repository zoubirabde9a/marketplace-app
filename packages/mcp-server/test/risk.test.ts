import { describe, expect, it } from "vitest";
import { McpRegistry, type McpContext } from "../src/registry.js";
import { registerRiskTools } from "../src/tools/risk.js";

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
  registerRiskTools(r);
  return r;
};

const invoke = (input: unknown) =>
  reg().invoke("catalog.score_counterfeit", input, ctx(["catalog:read"]));

const cleanSignals = {
  brandRegistryMismatch: false,
  sellerAgeDays: 1000,
  imageHashHits: 0,
  descriptionAnomalies: 0,
};

describe("catalog.score_counterfeit — risk bands", () => {
  it("clean signals → low risk, all-permissive actions", async () => {
    const out = (await invoke({ listingId: "l1", signals: cleanSignals })) as {
      risk: string;
      score: number;
      actions: { visible: boolean; derank: boolean; payoutHeld: boolean; requireSupplyChainDoc: boolean; reviewSlaHours?: number };
    };
    expect(out.risk).toBe("low");
    expect(out.score).toBe(0);
    expect(out.actions).toEqual({
      visible: true,
      derank: false,
      payoutHeld: false,
      requireSupplyChainDoc: false,
    });
  });

  it("price 60% of authorized floor + new low-rep seller → elevated, payout held", async () => {
    const out = (await invoke({
      listingId: "l1",
      signals: {
        ...cleanSignals,
        priceVsAuthorizedFloorBps: 6000, // < 6500 threshold → +25
        sellerAgeDays: 30, // < 90
        sellerReputationBps: 3000, // < 5000 → +15
      },
    })) as { risk: string; actions: { payoutHeld: boolean; derank: boolean; visible: boolean; requireSupplyChainDoc: boolean } };
    // 25 + 15 = 40 → elevated
    expect(out.risk).toBe("elevated");
    expect(out.actions.visible).toBe(true);
    expect(out.actions.derank).toBe(true);
    expect(out.actions.payoutHeld).toBe(true);
    expect(out.actions.requireSupplyChainDoc).toBe(true);
  });

  it("brand mismatch + image hash hit → high, hidden, 48h SLA", async () => {
    const out = (await invoke({
      listingId: "l1",
      signals: {
        ...cleanSignals,
        brandRegistryMismatch: true, // +35
        imageHashHits: 1, // +30
      },
    })) as {
      risk: string;
      score: number;
      actions: { visible: boolean; reviewSlaHours?: number };
    };
    expect(out.risk).toBe("high");
    expect(out.score).toBeGreaterThanOrEqual(50);
    expect(out.actions.visible).toBe(false);
    expect(out.actions.reviewSlaHours).toBe(48);
  });

  it("description anomalies cap at +8 (3 anomalies = full weight)", async () => {
    const out3 = (await invoke({
      listingId: "l1",
      signals: { ...cleanSignals, descriptionAnomalies: 3 },
    })) as { score: number };
    const out10 = (await invoke({
      listingId: "l1",
      signals: { ...cleanSignals, descriptionAnomalies: 10 },
    })) as { score: number };
    expect(out3.score).toBe(8);
    expect(out10.score).toBe(8);
  });

  it("buyer-side refund rate ≤ 1.5× baseline → no contribution", async () => {
    const out = (await invoke({
      listingId: "l1",
      signals: {
        ...cleanSignals,
        refundRateBps: 100,
        categoryBaselineRefundBps: 100,
      },
    })) as { score: number };
    expect(out.score).toBe(0);
  });

  it("buyer-side refund rate > 1.5× baseline → +12 (elevated alone insufficient)", async () => {
    const out = (await invoke({
      listingId: "l1",
      signals: {
        ...cleanSignals,
        refundRateBps: 200,
        categoryBaselineRefundBps: 100,
      },
    })) as { risk: string; score: number; contributors: Array<{ name: string }> };
    // 12 alone → still low
    expect(out.score).toBe(12);
    expect(out.risk).toBe("low");
    expect(out.contributors.map((c) => c.name)).toContain("elevated_refund_rate");
  });

  it("returns the listingId echo so batch callers can correlate results", async () => {
    const out = (await invoke({ listingId: "l-echo", signals: cleanSignals })) as { listingId: string };
    expect(out.listingId).toBe("l-echo");
  });

  it("contributors list names every triggered weight", async () => {
    const out = (await invoke({
      listingId: "l1",
      signals: {
        ...cleanSignals,
        brandRegistryMismatch: true,
        imageHashHits: 1,
        descriptionAnomalies: 2,
      },
    })) as { contributors: Array<{ name: string }> };
    const names = out.contributors.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(["brand_registry_mismatch", "image_hash_hit", "description_anomalies"]),
    );
  });

  it("denies invocation without catalog:read scope", async () => {
    const r = reg();
    await expect(
      r.invoke("catalog.score_counterfeit", { listingId: "l1", signals: cleanSignals }, ctx([])),
    ).rejects.toThrow(/missing_scope:catalog:read/);
  });
});
