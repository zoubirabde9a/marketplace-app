import { describe, expect, it } from "vitest";
import { McpRegistry, type McpContext } from "../src/registry.js";
import { registerReviewTools } from "../src/tools/review.js";

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

const NOW = new Date("2026-05-04T18:00:00Z");
const SETTLED_RECENT = new Date("2026-05-01T00:00:00Z");
const SETTLED_OLD = new Date("2025-01-01T00:00:00Z");

const reg = (): McpRegistry => {
  const r = new McpRegistry();
  registerReviewTools(r);
  return r;
};

const invoke = (input: unknown) =>
  reg().invoke("review.write", input, ctx(["review:write"]));

const baseInput = {
  reviewerUserId: "usr_1",
  productId: "p1",
  reviewerSettledItems: [
    { productId: "p1", orderItemId: "oi-1", settledAt: SETTLED_RECENT.toISOString(), outcome: "kept" as const },
  ],
  reviewWindowDays: 60,
  existingReviewsOnItem: 0,
  now: NOW.toISOString(),
  body: "Solid product, would buy again.",
  rating: 5,
};

describe("review.write — eligibility gate", () => {
  it("accepts verified-purchase reviewer and returns moderation=visible", async () => {
    const out = (await invoke(baseInput)) as {
      orderItemId: string;
      outcome: string;
      authorKind: string;
      moderation: { status: string };
    };
    expect(out.orderItemId).toBe("oi-1");
    expect(out.outcome).toBe("kept");
    expect(out.authorKind).toBe("human");
    expect(out.moderation.status).toBe("visible");
  });

  it("tags author as agent when reviewerAgentId is supplied", async () => {
    const out = (await invoke({
      ...baseInput,
      reviewerUserId: undefined,
      reviewerAgentId: "agt_buyer",
    })) as { authorKind: string };
    expect(out.authorKind).toBe("agent");
  });

  it("rejects when neither user nor agent id is supplied", async () => {
    await expect(
      invoke({ ...baseInput, reviewerUserId: undefined }),
    ).rejects.toThrow(/review_no_principal/);
  });

  it("rejects when no settled order on this product", async () => {
    await expect(
      invoke({ ...baseInput, reviewerSettledItems: [] }),
    ).rejects.toThrow(/review_no_settled_purchase/);
  });

  it("rejects when settled purchase is past the review window", async () => {
    await expect(
      invoke({
        ...baseInput,
        reviewerSettledItems: [
          { productId: "p1", orderItemId: "oi-old", settledAt: SETTLED_OLD.toISOString(), outcome: "kept" },
        ],
      }),
    ).rejects.toThrow(/review_no_settled_purchase/);
  });

  it("matches by canonicalProductId across listings", async () => {
    const out = (await invoke({
      ...baseInput,
      productId: "p1-other-listing",
      canonicalProductId: "canon-1",
      reviewerSettledItems: [
        {
          productId: "p1-original",
          canonicalProductId: "canon-1",
          orderItemId: "oi-canon",
          settledAt: SETTLED_RECENT.toISOString(),
          outcome: "kept",
        },
      ],
    })) as { orderItemId: string };
    expect(out.orderItemId).toBe("oi-canon");
  });

  it("rejects second review on same order item", async () => {
    await expect(
      invoke({ ...baseInput, existingReviewsOnItem: 1 }),
    ).rejects.toThrow(/review_already_exists_for_order_item/);
  });

  it("carries returned outcome through to the result", async () => {
    const out = (await invoke({
      ...baseInput,
      reviewerSettledItems: [
        { productId: "p1", orderItemId: "oi-r", settledAt: SETTLED_RECENT.toISOString(), outcome: "returned" },
      ],
    })) as { outcome: string };
    expect(out.outcome).toBe("returned");
  });
});

describe("review.write — moderation classifier wired in", () => {
  it("self-review signal → suppressed + seller penalty", async () => {
    const out = (await invoke({
      ...baseInput,
      signals: { burstCount: 0, burstThreshold: 5, incentiveDetected: false, selfReview: true, honeypotEcho: false },
    })) as { moderation: { status: string; sellerPenalty: boolean; reasons: string[] } };
    expect(out.moderation.status).toBe("suppressed");
    expect(out.moderation.sellerPenalty).toBe(true);
    expect(out.moderation.reasons).toContain("self_review");
  });

  it("honeypot echo → suppressed", async () => {
    const out = (await invoke({
      ...baseInput,
      signals: { burstCount: 0, burstThreshold: 5, incentiveDetected: false, selfReview: false, honeypotEcho: true },
    })) as { moderation: { status: string; reasons: string[] } };
    expect(out.moderation.status).toBe("suppressed");
    expect(out.moderation.reasons).toContain("honeypot_echo");
  });

  it("burst + linguistic cluster → excluded_from_avg or suppressed", async () => {
    const out = (await invoke({
      ...baseInput,
      signals: {
        burstCount: 50,
        burstThreshold: 5,
        linguisticSimilarity: 0.95,
        incentiveDetected: false,
        selfReview: false,
        honeypotEcho: false,
      },
    })) as { moderation: { status: string; reasons: string[] } };
    // 30 (burst) + 25 (linguistic) = 55 → suppressed
    expect(out.moderation.status).toBe("suppressed");
    expect(out.moderation.reasons).toEqual(
      expect.arrayContaining(["burst_detection", "linguistic_cluster"]),
    );
  });

  it("verifiedPurchase is force-set to true (cannot be bypassed by client)", async () => {
    // Note: client signals don't include verifiedPurchase — the tool sets it true
    // because step 1 already enforced eligibility. This test confirms the tool's
    // moderation never sees an unverified-purchase contribution after the gate passed.
    const out = (await invoke({
      ...baseInput,
      signals: { burstCount: 0, burstThreshold: 5, incentiveDetected: false, selfReview: false, honeypotEcho: false },
    })) as { moderation: { reasons: string[] } };
    expect(out.moderation.reasons).not.toContain("not_verified_purchase");
  });
});

describe("review.write — scope enforcement", () => {
  it("denies invocation without review:write scope", async () => {
    const r = reg();
    await expect(r.invoke("review.write", baseInput, ctx([]))).rejects.toThrow(
      /missing_scope:review:write/,
    );
  });
});
