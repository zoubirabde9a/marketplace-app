import { describe, expect, it } from "vitest";
import { runFullLifecycle } from "../src/journeys/buyer-full-lifecycle.ts";

const NOW = new Date("2026-05-04T18:00:00Z");
const PAST = new Date("2025-01-01T00:00:00Z");

const baseCandidate = {
  productId: "p-1",
  listingId: "l-1",
  variantId: "v-1",
  sellerId: "org_acme",
  unitPriceMinor: 5000n,
  qty: 1,
  taxonomyKeys: ["apparel/shirts"],
  isHazmat: false,
  isAgeRestricted: false,
  countryOfOrigin: "US",
};

const baseInput = {
  buyerUserId: "usr_buyer",
  passportId: "psp_buyer",
  caps: { currency: "USD", perTxMinor: 50000n, perDayMinor: 200000n, perMerchantMinor: 100000n },
  usage: { todayMinor: 0n, perMerchantMinor: [] as Array<[string, bigint]> },
  velocity: { rolling30dMedianMinor: 5000n, txLastHour: 0 },
  abortOnVelocityAnomaly: true,
  shipToCountry: "US",
  isSanctionedParty: false,
  carriersAvailable: [{ key: "default", prohibitedItems: [] }],
  rules: [],
  candidates: [baseCandidate],
  reviewWindowDays: 60,
  reviewBody: "Solid product",
  reviewRating: 5,
  now: NOW,
};

describe("buyer full-lifecycle journey (E2E SOP 03 + 05 + 12)", () => {
  it("happy path → delivered with full transition trace and visible review", async () => {
    const out = await runFullLifecycle(baseInput);
    if (out.stage !== "delivered") throw new Error(`unexpected stage: ${out.stage}`);
    expect(out.cart).toHaveLength(1);
    expect(out.orderTrace.map((t) => t.event)).toEqual([
      "authorize",
      "capture",
      "begin_fulfillment",
      "ship",
      "deliver",
    ]);
    expect(out.orderTrace.at(-1)?.to).toBe("delivered");
    expect(out.reviewStatus).toBe("visible");
  });

  it("blocks at spend-cap stage when total exceeds per-tx", async () => {
    const out = await runFullLifecycle({
      ...baseInput,
      caps: { ...baseInput.caps, perTxMinor: 1000n },
    });
    expect(out.stage).toBe("blocked_spend_cap");
    if (out.stage === "blocked_spend_cap") {
      expect(out.reason).toMatch(/spend_cap_per_tx_exceeded:5000>1000/);
    }
  });

  it("blocks at velocity stage on a geo-jump (anomaly + abort)", async () => {
    const t = NOW.getTime();
    const out = await runFullLifecycle({
      ...baseInput,
      velocity: {
        rolling30dMedianMinor: 5000n,
        txLastHour: 0,
        lastLocation: { lat: 40.7, lng: -74.0, atMs: t - 1800_000 },
        currentLocation: { lat: 51.5, lng: -0.1, atMs: t },
      },
    });
    expect(out.stage).toBe("blocked_velocity");
    if (out.stage === "blocked_velocity") {
      expect(out.reasons).toContain("geo_jump_1000km_under_1h");
    }
  });

  it("anomaly proceeds when abortOnVelocityAnomaly is false (step-up branch)", async () => {
    const out = await runFullLifecycle({
      ...baseInput,
      abortOnVelocityAnomaly: false,
      velocity: { rolling30dMedianMinor: 100n, txLastHour: 0, } as any,
      candidates: [{ ...baseCandidate, unitPriceMinor: 1000n }],
    });
    expect(out.stage).toBe("delivered");
  });

  it("blocks at restrictions stage on sanctioned buyer", async () => {
    const out = await runFullLifecycle({ ...baseInput, isSanctionedParty: true });
    expect(out.stage).toBe("blocked_restrictions");
    if (out.stage === "blocked_restrictions") {
      expect(out.blocked[0]?.reason).toBe("buyer_sanctioned_party");
      expect(out.blocked[0]?.reasonClass).toBe("hard");
    }
  });

  it("blocks at restrictions stage when prohibited taxonomy applies", async () => {
    const out = await runFullLifecycle({
      ...baseInput,
      candidates: [{ ...baseCandidate, taxonomyKeys: ["weapons/handguns"] }],
      rules: [
        {
          taxonomyKey: "weapons",
          countryCode: "US",
          restrictionKind: "prohibited",
          effectiveFrom: PAST,
          registryVersion: "rules-v1",
        },
      ],
    });
    expect(out.stage).toBe("blocked_restrictions");
    if (out.stage === "blocked_restrictions") {
      expect(out.blocked[0]?.reason).toBe("prohibited_in_jurisdiction");
    }
  });

  it("multi-line cart aggregates total against per-tx cap", async () => {
    const out = await runFullLifecycle({
      ...baseInput,
      candidates: [
        baseCandidate,
        { ...baseCandidate, productId: "p-2", listingId: "l-2", variantId: "v-2" },
        { ...baseCandidate, productId: "p-3", listingId: "l-3", variantId: "v-3" },
      ],
      caps: { ...baseInput.caps, perTxMinor: 12000n },
    });
    expect(out.stage).toBe("blocked_spend_cap");
    if (out.stage === "blocked_spend_cap") {
      expect(out.reason).toMatch(/spend_cap_per_tx_exceeded:15000>12000/);
    }
  });
});
