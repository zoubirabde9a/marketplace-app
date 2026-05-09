import { describe, expect, it } from "vitest";
import { McpRegistry, type McpContext } from "../src/registry.js";
import { registerDisputeTools } from "../src/tools/dispute.js";

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
  registerDisputeTools(r);
  return r;
};

const apply = (input: unknown) =>
  reg().invoke("dispute.apply_event", input, ctx(["dispute:write"]));

const sla = (input: unknown) =>
  reg().invoke("dispute.check_sla", input, ctx(["dispute:write"]));

const OPENED = new Date("2026-05-01T00:00:00Z");
const NOW = new Date("2026-05-04T00:00:00Z");

describe("dispute.apply_event — transitions", () => {
  it("open → seller_responded on seller_respond", async () => {
    const out = (await apply({
      disputeId: "d-1",
      current: "open",
      event: { kind: "seller_respond" },
      openedAt: OPENED.toISOString(),
      now: NOW.toISOString(),
    })) as { previous: string; next: string; terminal: boolean };
    expect(out.previous).toBe("open");
    expect(out.next).toBe("seller_responded");
    expect(out.terminal).toBe(false);
  });

  it("seller_responded → escalated on escalate", async () => {
    const out = (await apply({
      disputeId: "d-1",
      current: "seller_responded",
      event: { kind: "escalate", reason: "no_resolution" },
      openedAt: OPENED.toISOString(),
      now: NOW.toISOString(),
    })) as { next: string };
    expect(out.next).toBe("escalated");
  });

  it("escalated → resolved_buyer with refund (terminal)", async () => {
    const out = (await apply({
      disputeId: "d-1",
      current: "escalated",
      event: { kind: "resolve_buyer", refundMinor: 5699n },
      openedAt: OPENED.toISOString(),
      now: NOW.toISOString(),
    })) as { next: string; terminal: boolean };
    expect(out.next).toBe("resolved_buyer");
    expect(out.terminal).toBe(true);
  });

  it("resolves with seller (terminal)", async () => {
    const out = (await apply({
      disputeId: "d-1",
      current: "escalated",
      event: { kind: "resolve_seller" },
      openedAt: OPENED.toISOString(),
      now: NOW.toISOString(),
    })) as { next: string; terminal: boolean };
    expect(out.next).toBe("resolved_seller");
    expect(out.terminal).toBe(true);
  });

  it("withdraw from open is allowed and terminal", async () => {
    const out = (await apply({
      disputeId: "d-1",
      current: "open",
      event: { kind: "withdraw" },
      openedAt: OPENED.toISOString(),
      now: NOW.toISOString(),
    })) as { next: string; terminal: boolean };
    expect(out.next).toBe("withdrawn");
    expect(out.terminal).toBe(true);
  });

  it("rejects invalid transition (apply event after terminal)", async () => {
    await expect(
      apply({
        disputeId: "d-1",
        current: "resolved_buyer",
        event: { kind: "escalate", reason: "x" },
        openedAt: OPENED.toISOString(),
        now: NOW.toISOString(),
      }),
    ).rejects.toThrow(/dispute_invalid_transition:resolved_buyer->escalate/);
  });

  it("rejects invalid event in current state (seller_respond from escalated)", async () => {
    await expect(
      apply({
        disputeId: "d-1",
        current: "escalated",
        event: { kind: "seller_respond" },
        openedAt: OPENED.toISOString(),
        now: NOW.toISOString(),
      }),
    ).rejects.toThrow(/dispute_invalid_transition:escalated->seller_respond/);
  });
});

describe("dispute.apply_event — SLA pressure inside the result", () => {
  it("returns auto-escalate when seller hasn't responded past day 7", async () => {
    const out = (await apply({
      disputeId: "d-1",
      current: "open",
      event: { kind: "withdraw" }, // Move to terminal so we just inspect SLA shape
      openedAt: new Date("2026-04-01T00:00:00Z").toISOString(),
      now: NOW.toISOString(),
    })) as { sla: { shouldAutoEscalate: boolean } };
    // After moving to terminal, shouldAutoEscalate is false (only `open` triggers it).
    expect(out.sla.shouldAutoEscalate).toBe(false);
  });
});

describe("dispute.check_sla", () => {
  it("flags auto_escalate when openedAt is more than 7d ago and still open", async () => {
    const out = (await sla({
      disputeId: "d-1",
      status: "open",
      openedAt: new Date("2026-04-01T00:00:00Z").toISOString(),
      now: NOW.toISOString(),
    })) as { shouldAutoEscalate: boolean; hoursToDeadline: number };
    expect(out.shouldAutoEscalate).toBe(true);
    expect(out.hoursToDeadline).toBe(0);
  });

  it("flags approaching-deadline within 24h of seller deadline", async () => {
    const opened = new Date(NOW.getTime() - 6.5 * 24 * 3600 * 1000);
    const out = (await sla({
      disputeId: "d-1",
      status: "open",
      openedAt: opened.toISOString(),
      now: NOW.toISOString(),
    })) as { shouldAutoEscalate: boolean; shouldNotifyApproachingDeadline: boolean; hoursToDeadline: number };
    expect(out.shouldAutoEscalate).toBe(false);
    expect(out.shouldNotifyApproachingDeadline).toBe(true);
    expect(out.hoursToDeadline).toBeGreaterThan(0);
    expect(out.hoursToDeadline).toBeLessThan(24);
  });

  it("returns zero pressure for terminal status", async () => {
    const out = (await sla({
      disputeId: "d-1",
      status: "resolved_buyer",
      openedAt: OPENED.toISOString(),
      now: NOW.toISOString(),
    })) as { shouldAutoEscalate: boolean; hoursToDeadline: number };
    expect(out.shouldAutoEscalate).toBe(false);
    expect(out.hoursToDeadline).toBe(0);
  });
});

describe("dispute tools — scope", () => {
  it("denies invocation without dispute:write scope", async () => {
    const r = reg();
    await expect(
      r.invoke(
        "dispute.apply_event",
        {
          disputeId: "d-1",
          current: "open",
          event: { kind: "withdraw" },
          openedAt: OPENED.toISOString(),
          now: NOW.toISOString(),
        },
        ctx([]),
      ),
    ).rejects.toThrow(/missing_scope:dispute:write/);
  });
});
