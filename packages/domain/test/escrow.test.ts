import { describe, expect, it } from "vitest";
import {
  allowedEscrowEventKinds,
  applyEscrowEvent,
  canApplyEscrowEvent,
  computeReleaseAt,
  ESCROW_RELEASE_DAYS,
  type EscrowHold,
} from "../src/escrow/hold.js";

const hold = (overrides: Partial<EscrowHold> = {}): EscrowHold => ({
  holdId: "h1",
  orderId: "o1",
  sellerOrgId: "s1",
  amountMinor: 100_00n,
  currency: "USD",
  reason: "new_seller",
  releaseAt: new Date("2026-06-02"),
  status: "held",
  ...overrides,
});

describe("escrow events", () => {
  it("releases at or after releaseAt", () => {
    const r = applyEscrowEvent(hold(), { kind: "release", at: new Date("2026-06-03") });
    expect(r.status).toBe("released");
  });

  it("rejects premature release", () => {
    expect(() => applyEscrowEvent(hold(), { kind: "release", at: new Date("2026-05-01") })).toThrow(
      /premature/,
    );
  });

  it("claws back held funds on counterfeit finding", () => {
    const r = applyEscrowEvent(hold(), { kind: "claw_back", reason: "counterfeit_confirmed" });
    expect(r.status).toBe("clawed_back");
  });

  it("dispute path: open → close favoring seller releases", () => {
    let h = applyEscrowEvent(hold(), { kind: "open_dispute" });
    expect(h.status).toBe("in_dispute");
    h = applyEscrowEvent(h, { kind: "close_dispute", favoredSeller: true });
    expect(h.status).toBe("released");
  });

  it("dispute path: close favoring buyer claws back", () => {
    let h = applyEscrowEvent(hold(), { kind: "open_dispute" });
    h = applyEscrowEvent(h, { kind: "close_dispute", favoredSeller: false });
    expect(h.status).toBe("clawed_back");
  });

  it("rejects double-release", () => {
    const r = applyEscrowEvent(hold(), { kind: "release", at: new Date("2026-06-03") });
    expect(() => applyEscrowEvent(r, { kind: "release", at: new Date("2026-06-04") })).toThrow();
  });

  it("standard release windows defined per reason", () => {
    expect(ESCROW_RELEASE_DAYS.new_seller).toBe(30);
    expect(ESCROW_RELEASE_DAYS.high_risk_category).toBe(14);
  });

  it("computeReleaseAt derives the standard window for a reason", () => {
    const now = new Date("2026-05-15T00:00:00Z");
    const r = computeReleaseAt("new_seller", now);
    // 30 days
    expect(r.toISOString()).toBe("2026-06-14T00:00:00.000Z");
  });

  it("canApplyEscrowEvent previews transitions without throwing", () => {
    const held = hold();
    expect(canApplyEscrowEvent(held, "open_dispute")).toBe(true);
    expect(canApplyEscrowEvent(held, "release", new Date("2026-05-01"))).toBe(false); // premature
    expect(canApplyEscrowEvent(held, "release", new Date("2026-06-03"))).toBe(true);
    const released = applyEscrowEvent(held, { kind: "release", at: new Date("2026-06-03") });
    expect(canApplyEscrowEvent(released, "claw_back")).toBe(false);
    expect(canApplyEscrowEvent(released, "release")).toBe(false);
  });

  it("allowedEscrowEventKinds enumerates what would apply cleanly right now", () => {
    const held = hold();
    expect(allowedEscrowEventKinds(held, new Date("2026-05-01")).sort()).toEqual(
      ["claw_back", "open_dispute"].sort(),
    );
    expect(allowedEscrowEventKinds(held, new Date("2026-06-03")).sort()).toEqual(
      ["claw_back", "open_dispute", "release"].sort(),
    );
    const inDispute = applyEscrowEvent(held, { kind: "open_dispute" });
    expect(allowedEscrowEventKinds(inDispute).sort()).toEqual(
      ["claw_back", "close_dispute"].sort(),
    );
  });
});
