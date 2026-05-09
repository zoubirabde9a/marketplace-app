import { describe, expect, it } from "vitest";
import {
  applyDisputeEvent,
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
});
