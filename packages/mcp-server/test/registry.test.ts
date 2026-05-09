import { describe, expect, it } from "vitest";
import { z } from "zod";
import { McpRegistry, type McpContext } from "../src/registry.js";

function ctx(scopes: string[]): McpContext {
  const audits: unknown[] = [];
  return {
    agentId: "agt_1",
    passportId: "psp_1",
    scopes: new Set(scopes),
    ownerKind: "user",
    ownerId: "usr_1",
    requestId: "req_1",
    now: () => 0,
    emitAudit: async (e) => {
      audits.push(e);
    },
  };
}

describe("McpRegistry", () => {
  it("rejects names that aren't noun.verb", () => {
    const r = new McpRegistry();
    expect(() =>
      r.register({
        name: "noverb",
        description: "x",
        scope: "catalog:read",
        auditEvent: "x",
        idempotent: true,
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        handler: async () => ({}),
      }),
    ).toThrow(/noun_verb/);
  });

  it("rejects duplicate registrations", () => {
    const r = new McpRegistry();
    const def = {
      name: "catalog.search",
      description: "",
      scope: "catalog:read",
      auditEvent: "x",
      idempotent: true,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      handler: async () => ({}),
    };
    r.register(def);
    expect(() => r.register(def)).toThrow(/already_registered/);
  });

  it("denies invocation without required scope", async () => {
    const r = new McpRegistry();
    r.register({
      name: "catalog.search",
      description: "",
      scope: "catalog:read",
      auditEvent: "x",
      idempotent: true,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      handler: async () => ({}),
    });
    await expect(r.invoke("catalog.search", {}, ctx([]))).rejects.toThrow(/missing_scope/);
  });

  it("invokes handler when scope present and validates output", async () => {
    const r = new McpRegistry();
    r.register({
      name: "catalog.search",
      description: "",
      scope: "catalog:read",
      auditEvent: "x",
      idempotent: true,
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ count: z.number() }),
      handler: async (input) => ({ count: input.q.length }),
    });
    const out = await r.invoke("catalog.search", { q: "hello" }, ctx(["catalog:read"]));
    expect(out).toEqual({ count: 5 });
  });

  it("emits audit on success and on denial", async () => {
    const events: string[] = [];
    const r = new McpRegistry();
    r.register({
      name: "catalog.search",
      description: "",
      scope: "catalog:read",
      auditEvent: "x",
      idempotent: true,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      handler: async () => ({}),
    });
    const audit = (msg: string) => () => { events.push(msg); };
    await r.invoke("catalog.search", {}, {
      ...ctx(["catalog:read"]),
      emitAudit: async (e) => { events.push(e.status); },
    });
    expect(events).toContain("ok");
    await expect(
      r.invoke("catalog.search", {}, {
        ...ctx([]),
        emitAudit: async (e) => { events.push(e.status); },
      }),
    ).rejects.toThrow();
    expect(events).toContain("denied");
    expect(audit).toBeDefined();
  });
});
