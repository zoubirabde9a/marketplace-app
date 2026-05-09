import { describe, expect, it } from "vitest";
import { McpRegistry, type McpContext } from "../src/registry.js";
import { registerSubscriptionTools } from "../src/tools/subscription.js";

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
  registerSubscriptionTools(r);
  return r;
};

const NOW = new Date("2026-05-04T18:00:00Z");
const NEXT_RENEWAL = new Date("2026-05-04T17:30:00Z");
const FAR_FUTURE = new Date("2027-05-04T00:00:00Z");

const baseState = {
  status: "active" as const,
  nextRenewalAt: NEXT_RENEWAL,
  retryCount: 0,
  mandateRefreshDueAt: FAR_FUTURE,
  consumedMinor: 0n,
  cyclesCompleted: 3,
};

const previewInvoke = (input: unknown) =>
  reg().invoke("subscription.preview_renewal", input, ctx(["subscription:write"]));

const retryInvoke = (input: unknown) =>
  reg().invoke("subscription.plan_retry", input, ctx(["subscription:write"]));

describe("subscription.preview_renewal", () => {
  it("active subscription due now → charge_now", async () => {
    const out = (await previewInvoke({
      subscriptionId: "sub-1",
      state: baseState,
      amountMinor: 1000n,
      now: NOW.toISOString(),
    })) as { outcome: { kind: string }; preChargeNotificationDueAt: string };
    expect(out.outcome.kind).toBe("charge_now");
    // Pre-charge notice is 72h before nextRenewalAt: 17:30Z - 72h = 2026-05-01T17:30Z
    expect(new Date(out.preChargeNotificationDueAt).toISOString()).toBe(
      "2026-05-01T17:30:00.000Z",
    );
  });

  it("subscription paused → skip with reason", async () => {
    const out = (await previewInvoke({
      subscriptionId: "sub-1",
      state: { ...baseState, status: "paused" },
      amountMinor: 1000n,
      now: NOW.toISOString(),
    })) as { outcome: { kind: string; reason: string } };
    expect(out.outcome.kind).toBe("skip");
    expect(out.outcome.reason).toBe("subscription_paused");
  });

  it("mandate refresh past-due → mandate_refresh_required", async () => {
    const out = (await previewInvoke({
      subscriptionId: "sub-1",
      state: { ...baseState, mandateRefreshDueAt: new Date("2026-04-01T00:00:00Z") },
      amountMinor: 1000n,
      now: NOW.toISOString(),
    })) as { outcome: { kind: string } };
    expect(out.outcome.kind).toBe("mandate_refresh_required");
  });

  it("total cap exhausted → auto_pause", async () => {
    const out = (await previewInvoke({
      subscriptionId: "sub-1",
      state: { ...baseState, totalCapMinor: 1500n, consumedMinor: 1000n },
      amountMinor: 600n,
      now: NOW.toISOString(),
    })) as { outcome: { kind: string; reason: string } };
    expect(out.outcome.kind).toBe("auto_pause");
    expect(out.outcome.reason).toBe("total_cap_exhausted");
  });

  it("end_after_cycles reached → skip", async () => {
    const out = (await previewInvoke({
      subscriptionId: "sub-1",
      state: { ...baseState, endAfterCycles: 3, cyclesCompleted: 3 },
      amountMinor: 1000n,
      now: NOW.toISOString(),
    })) as { outcome: { kind: string; reason: string } };
    expect(out.outcome.kind).toBe("skip");
    expect(out.outcome.reason).toBe("end_after_cycles_reached");
  });

  it("not yet due → skip", async () => {
    const out = (await previewInvoke({
      subscriptionId: "sub-1",
      state: { ...baseState, nextRenewalAt: new Date("2026-06-01T00:00:00Z") },
      amountMinor: 1000n,
      now: NOW.toISOString(),
    })) as { outcome: { kind: string; reason: string } };
    expect(out.outcome.kind).toBe("skip");
    expect(out.outcome.reason).toBe("not_yet_due");
  });
});

describe("subscription.plan_retry", () => {
  it("first failure → schedule retry +1d, retryCount=1", async () => {
    const failureAt = new Date("2026-05-04T18:00:00Z");
    const out = (await retryInvoke({
      subscriptionId: "sub-1",
      state: baseState,
      failureAt: failureAt.toISOString(),
    })) as { outcome: { kind: string; nextAttemptAt: string; retryCount: number } };
    expect(out.outcome.kind).toBe("schedule_retry");
    expect(out.outcome.retryCount).toBe(1);
    expect(new Date(out.outcome.nextAttemptAt).toISOString()).toBe(
      "2026-05-05T18:00:00.000Z",
    );
  });

  it("second failure → schedule retry +3d, retryCount=2", async () => {
    const out = (await retryInvoke({
      subscriptionId: "sub-1",
      state: { ...baseState, retryCount: 1, lastFailureAt: new Date("2026-05-04T18:00:00Z") },
      failureAt: new Date("2026-05-05T18:00:00Z").toISOString(),
    })) as { outcome: { kind: string; nextAttemptAt: string; retryCount: number } };
    expect(out.outcome.kind).toBe("schedule_retry");
    expect(out.outcome.retryCount).toBe(2);
    expect(new Date(out.outcome.nextAttemptAt).toISOString()).toBe(
      "2026-05-08T18:00:00.000Z",
    );
  });

  it("third failure → schedule retry +7d, retryCount=3", async () => {
    const out = (await retryInvoke({
      subscriptionId: "sub-1",
      state: { ...baseState, retryCount: 2, lastFailureAt: new Date("2026-05-04T18:00:00Z") },
      failureAt: new Date("2026-05-08T18:00:00Z").toISOString(),
    })) as { outcome: { kind: string; nextAttemptAt: string; retryCount: number } };
    expect(out.outcome.kind).toBe("schedule_retry");
    expect(out.outcome.retryCount).toBe(3);
    expect(new Date(out.outcome.nextAttemptAt).toISOString()).toBe(
      "2026-05-15T18:00:00.000Z",
    );
  });

  it("fourth failure (retryCount already 3) → auto_pause max_retries_reached", async () => {
    const out = (await retryInvoke({
      subscriptionId: "sub-1",
      state: { ...baseState, retryCount: 3, lastFailureAt: new Date("2026-05-04T18:00:00Z") },
      failureAt: new Date("2026-05-10T18:00:00Z").toISOString(),
    })) as { outcome: { kind: string; reason: string } };
    expect(out.outcome.kind).toBe("auto_pause");
    expect(out.outcome.reason).toBe("max_retries_reached");
  });

  it("more than 14d since first failure → auto_pause max_retry_window_exceeded", async () => {
    const out = (await retryInvoke({
      subscriptionId: "sub-1",
      state: { ...baseState, retryCount: 1, lastFailureAt: new Date("2026-05-04T18:00:00Z") },
      failureAt: new Date("2026-05-19T18:00:00Z").toISOString(),
    })) as { outcome: { kind: string; reason: string } };
    expect(out.outcome.kind).toBe("auto_pause");
    expect(out.outcome.reason).toBe("max_retry_window_exceeded");
  });
});

describe("subscription tools — scope enforcement", () => {
  it("denies preview without subscription:write scope", async () => {
    const r = reg();
    await expect(
      r.invoke(
        "subscription.preview_renewal",
        { subscriptionId: "sub-1", state: baseState, amountMinor: 1000n, now: NOW.toISOString() },
        ctx([]),
      ),
    ).rejects.toThrow(/missing_scope:subscription:write/);
  });
});
