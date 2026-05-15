import { describe, expect, it } from "vitest";
import { evaluateRenewal, planRetry, preChargeNotificationDue } from "../src/subscription/renewal.js";

const baseState = {
  status: "active" as const,
  nextRenewalAt: new Date("2026-05-03T00:00:00Z"),
  retryCount: 0,
  mandateRefreshDueAt: new Date("2027-01-01T00:00:00Z"),
  consumedMinor: 0n,
  cyclesCompleted: 0,
};

describe("evaluateRenewal", () => {
  it("schedules charge when due", () => {
    const r = evaluateRenewal(baseState, { amountMinor: 1000n, now: new Date("2026-05-03T01:00:00Z") });
    expect(r.kind).toBe("charge_now");
  });

  it("skips when not yet due", () => {
    const r = evaluateRenewal(baseState, { amountMinor: 1000n, now: new Date("2026-04-01T00:00:00Z") });
    expect(r.kind).toBe("skip");
  });

  it("requires refresh past mandate due", () => {
    const r = evaluateRenewal(
      { ...baseState, mandateRefreshDueAt: new Date("2026-01-01T00:00:00Z") },
      { amountMinor: 1000n, now: new Date("2026-05-03T00:00:00Z") },
    );
    expect(r.kind).toBe("mandate_refresh_required");
  });

  it("auto-pauses when total cap exhausted", () => {
    const r = evaluateRenewal(
      { ...baseState, totalCapMinor: 1000n, consumedMinor: 800n },
      { amountMinor: 500n, now: new Date("2026-05-03T01:00:00Z") },
    );
    expect(r.kind).toBe("auto_pause");
  });

  it("skips when end_after_cycles reached", () => {
    const r = evaluateRenewal(
      { ...baseState, endAfterCycles: 12, cyclesCompleted: 12 },
      { amountMinor: 1000n, now: new Date("2026-05-03T01:00:00Z") },
    );
    expect(r.kind).toBe("skip");
  });
});

describe("planRetry", () => {
  it("uses 1d/3d/7d schedule", () => {
    const fail = new Date("2026-05-03T00:00:00Z");
    const r1 = planRetry({ ...baseState, retryCount: 0 }, fail);
    expect(r1.kind).toBe("schedule_retry");
    if (r1.kind === "schedule_retry") {
      expect((r1.nextAttemptAt.getTime() - fail.getTime()) / (24 * 3600 * 1000)).toBe(1);
    }
    const r2 = planRetry({ ...baseState, retryCount: 1 }, fail);
    if (r2.kind === "schedule_retry") {
      expect((r2.nextAttemptAt.getTime() - fail.getTime()) / (24 * 3600 * 1000)).toBe(3);
    }
    const r3 = planRetry({ ...baseState, retryCount: 2 }, fail);
    if (r3.kind === "schedule_retry") {
      expect((r3.nextAttemptAt.getTime() - fail.getTime()) / (24 * 3600 * 1000)).toBe(7);
    }
  });

  it("auto-pauses after exhausting retry list", () => {
    const r = planRetry({ ...baseState, retryCount: 3 }, new Date("2026-05-03"));
    expect(r.kind).toBe("auto_pause");
  });

  it("auto-pauses past 14d window from first failure", () => {
    const first = new Date("2026-05-01T00:00:00Z");
    const now = new Date("2026-05-16T00:00:00Z");
    const r = planRetry({ ...baseState, retryCount: 1, lastFailureAt: first }, now);
    expect(r.kind).toBe("auto_pause");
  });

  it("auto-pauses past 14d overdue from nextRenewalAt even when lastFailureAt refreshes", () => {
    // Defends against callers that read `lastFailureAt` literally and update
    // it on every retry. The original due date stays fixed, so the
    // nextRenewalAt-anchored check still fires the 14-day cutoff.
    const due = new Date("2026-05-03T00:00:00Z");
    const failureAt = new Date("2026-05-20T00:00:00Z"); // 17 days past due
    const r = planRetry(
      // lastFailureAt is "yesterday" (only 1 day since), but we're 17 days past due.
      { ...baseState, nextRenewalAt: due, retryCount: 1, lastFailureAt: new Date("2026-05-19T00:00:00Z") },
      failureAt,
    );
    expect(r.kind).toBe("auto_pause");
    if (r.kind === "auto_pause") {
      expect(r.reason).toBe("max_retry_window_exceeded");
    }
  });
});

describe("preChargeNotificationDue", () => {
  it("returns 72h before next renewal", () => {
    const due = preChargeNotificationDue({ ...baseState, nextRenewalAt: new Date("2026-05-10T00:00:00Z") });
    expect(due.toISOString()).toBe("2026-05-07T00:00:00.000Z");
  });
});
