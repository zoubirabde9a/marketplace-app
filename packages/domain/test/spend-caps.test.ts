import { describe, expect, it } from "vitest";
import { checkSpendCap, checkVelocity } from "../src/identity/spend-caps.js";
import { ForbiddenError } from "@marketplace/shared/errors";

describe("checkSpendCap", () => {
  const caps = {
    currency: "USD",
    perTxMinor: 500_00n,
    perDayMinor: 2_000_00n,
    perMerchantMinor: 1_000_00n,
  };

  it("allows a transaction within all caps", () => {
    expect(() =>
      checkSpendCap({
        caps,
        usage: { todayMinor: 0n, perMerchantMinor: new Map() },
        amountMinor: 100_00n,
        currency: "USD",
        merchantId: "m1",
      }),
    ).not.toThrow();
  });

  it("rejects per-tx exceedance", () => {
    expect(() =>
      checkSpendCap({
        caps,
        usage: { todayMinor: 0n, perMerchantMinor: new Map() },
        amountMinor: 600_00n,
        currency: "USD",
        merchantId: "m1",
      }),
    ).toThrow(ForbiddenError);
  });

  it("rejects per-day exceedance", () => {
    expect(() =>
      checkSpendCap({
        caps,
        usage: { todayMinor: 1_900_00n, perMerchantMinor: new Map() },
        amountMinor: 200_00n,
        currency: "USD",
        merchantId: "m1",
      }),
    ).toThrow(/per_day/);
  });

  it("rejects per-merchant exceedance", () => {
    const perMerchantMinor = new Map([["m1", 950_00n]]);
    expect(() =>
      checkSpendCap({
        caps,
        usage: { todayMinor: 0n, perMerchantMinor },
        amountMinor: 100_00n,
        currency: "USD",
        merchantId: "m1",
      }),
    ).toThrow(/per_merchant/);
  });

  it("rejects a zero amount (would otherwise trivially pass every cap)", () => {
    expect(() =>
      checkSpendCap({
        caps,
        usage: { todayMinor: 0n, perMerchantMinor: new Map() },
        amountMinor: 0n,
        currency: "USD",
        merchantId: "m1",
      }),
    ).toThrow(/amount_must_be_positive/);
  });

  it("rejects a negative amount", () => {
    expect(() =>
      checkSpendCap({
        caps,
        usage: { todayMinor: 0n, perMerchantMinor: new Map() },
        amountMinor: -100n,
        currency: "USD",
        merchantId: "m1",
      }),
    ).toThrow(/amount_must_be_positive/);
  });

  it("rejects on currency mismatch", () => {
    expect(() =>
      checkSpendCap({
        caps,
        usage: { todayMinor: 0n, perMerchantMinor: new Map() },
        amountMinor: 100_00n,
        currency: "EUR",
        merchantId: "m1",
      }),
    ).toThrow(/currency_mismatch/);
  });
});

describe("checkVelocity", () => {
  it("flags > 3x median spend", () => {
    const r = checkVelocity({
      rolling30dMedianMinor: 100_00n,
      amountMinor: 400_00n,
      txLastHour: 1,
    });
    expect(r.anomaly).toBe(true);
    expect(r.reasons).toContain("amount_3x_median");
  });

  it("flags > 10 tx/hour", () => {
    const r = checkVelocity({
      rolling30dMedianMinor: 100_00n,
      amountMinor: 50_00n,
      txLastHour: 12,
    });
    expect(r.reasons).toContain("tx_velocity_10x_per_hour");
  });

  it("flags > 1000km geo jump in < 1h", () => {
    const r = checkVelocity({
      rolling30dMedianMinor: 100_00n,
      amountMinor: 10_00n,
      txLastHour: 1,
      lastLocation: { lat: 40.7, lng: -74.0, atMs: 0 }, // NYC
      currentLocation: { lat: 51.5, lng: -0.13, atMs: 1000 * 60 * 30 }, // London 30min later
    });
    expect(r.anomaly).toBe(true);
    expect(r.reasons).toContain("geo_jump_1000km_under_1h");
  });

  it("still flags the geo-jump when timestamps are reordered (current older than last)", () => {
    // Adversarial input: an attacker controlling the timestamps could swap them
    // to make `currentLocation.atMs < lastLocation.atMs` and previously the
    // geo-jump check would silently skip. Now it uses |delta| and still fires.
    const r = checkVelocity({
      rolling30dMedianMinor: 100_00n,
      amountMinor: 10_00n,
      txLastHour: 1,
      lastLocation: { lat: 40.7, lng: -74.0, atMs: 1000 * 60 * 30 }, // NYC, "later"
      currentLocation: { lat: 51.5, lng: -0.13, atMs: 0 }, // London, "earlier"
    });
    expect(r.anomaly).toBe(true);
    expect(r.reasons).toContain("geo_jump_1000km_under_1h");
  });

  it("clears benign requests", () => {
    const r = checkVelocity({
      rolling30dMedianMinor: 100_00n,
      amountMinor: 50_00n,
      txLastHour: 1,
    });
    expect(r.anomaly).toBe(false);
  });
});
