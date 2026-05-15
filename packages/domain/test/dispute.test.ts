import { describe, expect, it } from "vitest";
import {
  allowedDisputeEventKinds,
  applyDisputeEvent,
  canApplyDisputeEvent,
  evaluateSla,
  isDisputeTerminal,
  type DisputeStatus,
} from "../src/dispute/state-machine.js";

describe("dispute state machine", () => {
  it("happy path: open → seller_responded → resolved_buyer", () => {
    let s: DisputeStatus = "open";
    s = applyDisputeEvent(s, { kind: "seller_respond" });
    s = applyDisputeEvent(s, { kind: "resolve_buyer", refundMinor: 100n });
    expect(s).toBe("resolved_buyer");
    expect(isDisputeTerminal(s)).toBe(true);
  });

  it("escalation path", () => {
    const s = applyDisputeEvent("open", { kind: "escalate", reason: "no_response" });
    expect(s).toBe("escalated");
  });

  it("rejects double-resolution", () => {
    expect(() => applyDisputeEvent("resolved_buyer", { kind: "resolve_seller" })).toThrow();
  });

  it("withdraw allowed from any non-terminal", () => {
    expect(applyDisputeEvent("open", { kind: "withdraw" })).toBe("withdrawn");
    expect(applyDisputeEvent("seller_responded", { kind: "withdraw" })).toBe("withdrawn");
    expect(applyDisputeEvent("escalated", { kind: "withdraw" })).toBe("withdrawn");
  });
});

describe("evaluateSla", () => {
  const opened = new Date("2026-05-01T00:00:00Z");

  it("auto-escalates open dispute past 7 days", () => {
    const r = evaluateSla("open", opened, new Date("2026-05-09T00:00:00Z"));
    expect(r.shouldAutoEscalate).toBe(true);
  });

  it("warns when within 1 day of seller-response deadline", () => {
    const r = evaluateSla("open", opened, new Date("2026-05-07T13:00:00Z"));
    expect(r.shouldNotifyApproachingDeadline).toBe(true);
  });

  it("escalated SLA is 14 days from open", () => {
    const r = evaluateSla("escalated", opened, new Date("2026-05-13T13:00:00Z"));
    expect(r.shouldNotifyApproachingDeadline).toBe(true);
  });

  it("clock-skew: `now < openedAt` clamps elapsed to 0 (no auto-escalate, full window remains)", () => {
    // Pre-fix, a negative elapsed went into `remaining = SLA - (negative)` so
    // hoursToDeadline showed a value larger than the SLA window.
    const r = evaluateSla("open", opened, new Date("2026-04-30T00:00:00Z"));
    expect(r.shouldAutoEscalate).toBe(false);
    expect(r.hoursToDeadline).toBe(7 * 24);
  });
});

describe("dispute state-machine read parity helpers", () => {
  it("canApplyDisputeEvent previews transitions without throwing", () => {
    expect(canApplyDisputeEvent("open", "seller_respond")).toBe(true);
    expect(canApplyDisputeEvent("open", "withdraw")).toBe(true);
    expect(canApplyDisputeEvent("resolved_buyer", "seller_respond")).toBe(false);
  });

  it("allowedDisputeEventKinds enumerates what would apply cleanly", () => {
    expect(allowedDisputeEventKinds("open").sort()).toEqual(
      ["escalate", "resolve_buyer", "resolve_seller", "seller_respond", "withdraw"].sort(),
    );
    expect(allowedDisputeEventKinds("escalated").sort()).toEqual(
      ["resolve_buyer", "resolve_seller", "withdraw"].sort(),
    );
    expect(allowedDisputeEventKinds("resolved_buyer")).toEqual([]);
  });
});
