import { describe, expect, it } from "vitest";
import { McpRegistry, type McpContext } from "../src/registry.js";
import { registerOrderTools } from "../src/tools/order.js";

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
  registerOrderTools(r);
  return r;
};

const apply = (input: unknown) =>
  reg().invoke("order.apply_event", input, ctx(["order:cancel"]));
const list = (input: unknown) =>
  reg().invoke("order.allowed_events", input, ctx(["order:read"]));

describe("order.apply_event — fulfillment path", () => {
  it("walks created → authorized → paid → fulfilling → shipped → delivered", async () => {
    const steps = [
      { current: "created", event: { kind: "authorize" }, expected: "authorized" },
      { current: "authorized", event: { kind: "capture" }, expected: "paid" },
      { current: "paid", event: { kind: "begin_fulfillment" }, expected: "fulfilling" },
      { current: "fulfilling", event: { kind: "ship" }, expected: "shipped" },
      { current: "shipped", event: { kind: "deliver" }, expected: "delivered" },
    ];
    for (const step of steps) {
      const out = (await apply({ orderId: "o-1", current: step.current, event: step.event })) as {
        next: string;
        terminal: boolean;
      };
      expect(out.next).toBe(step.expected);
      expect(out.terminal).toBe(false);
    }
  });

  it("cancel from created is allowed and terminal", async () => {
    const out = (await apply({
      orderId: "o-1",
      current: "created",
      event: { kind: "cancel", reason: "buyer_changed_mind" },
    })) as { next: string; terminal: boolean };
    expect(out.next).toBe("cancelled");
    expect(out.terminal).toBe(true);
  });

  it("refund from delivered → refunded (not terminal — disputes still allowed)", async () => {
    const out = (await apply({
      orderId: "o-1",
      current: "delivered",
      event: { kind: "refund", amountMinor: 5699n },
    })) as { next: string; terminal: boolean };
    expect(out.next).toBe("refunded");
    expect(out.terminal).toBe(false);
  });

  it("open_dispute from refunded transitions to disputed", async () => {
    const out = (await apply({
      orderId: "o-1",
      current: "refunded",
      event: { kind: "open_dispute", reason: "not_as_described" },
    })) as { next: string };
    expect(out.next).toBe("disputed");
  });

  it("rejects ship from authorized (must capture first)", async () => {
    await expect(
      apply({ orderId: "o-1", current: "authorized", event: { kind: "ship" } }),
    ).rejects.toThrow(/order_invalid_transition:authorized->ship/);
  });

  it("rejects any event after cancelled (terminal)", async () => {
    await expect(
      apply({ orderId: "o-1", current: "cancelled", event: { kind: "refund", amountMinor: 1n } }),
    ).rejects.toThrow(/order_invalid_transition:cancelled->refund/);
  });

  it("rejects deliver from paid (must begin_fulfillment then ship)", async () => {
    await expect(
      apply({ orderId: "o-1", current: "paid", event: { kind: "deliver" } }),
    ).rejects.toThrow(/order_invalid_transition:paid->deliver/);
  });
});

describe("order.allowed_events — read-only planning", () => {
  it("created allows authorize and cancel", async () => {
    const out = (await list({ orderId: "o-1", current: "created" })) as {
      allowedEvents: string[];
      terminal: boolean;
    };
    expect(out.allowedEvents.sort()).toEqual(["authorize", "cancel"].sort());
    expect(out.terminal).toBe(false);
  });

  it("paid allows begin_fulfillment, cancel, refund, open_dispute", async () => {
    const out = (await list({ orderId: "o-1", current: "paid" })) as { allowedEvents: string[] };
    expect(out.allowedEvents.sort()).toEqual(
      ["begin_fulfillment", "cancel", "open_dispute", "refund"].sort(),
    );
  });

  it("cancelled is terminal with no allowed events", async () => {
    const out = (await list({ orderId: "o-1", current: "cancelled" })) as {
      allowedEvents: string[];
      terminal: boolean;
    };
    expect(out.allowedEvents).toEqual([]);
    expect(out.terminal).toBe(true);
  });

  it("delivered allows refund and open_dispute (not terminal)", async () => {
    const out = (await list({ orderId: "o-1", current: "delivered" })) as {
      allowedEvents: string[];
      terminal: boolean;
    };
    expect(out.allowedEvents.sort()).toEqual(["open_dispute", "refund"].sort());
    expect(out.terminal).toBe(false);
  });
});

describe("order tools — scope enforcement", () => {
  it("denies apply without order:cancel scope", async () => {
    const r = reg();
    await expect(
      r.invoke(
        "order.apply_event",
        { orderId: "o-1", current: "created", event: { kind: "authorize" } },
        ctx([]),
      ),
    ).rejects.toThrow(/missing_scope:order:cancel/);
  });

  it("denies allowed_events without order:read scope", async () => {
    const r = reg();
    await expect(
      r.invoke("order.allowed_events", { orderId: "o-1", current: "created" }, ctx([])),
    ).rejects.toThrow(/missing_scope:order:read/);
  });
});
