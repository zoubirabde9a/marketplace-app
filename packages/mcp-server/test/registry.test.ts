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

  it("exposes a typed JSON Schema so clients serialize arrays as arrays", () => {
    // Regression guard for the structured-input bug: when list() returned a
    // permissive {additionalProperties: true} placeholder, MCP clients shipped
    // array fields as JSON strings and the Zod validator rejected them. The
    // schema must describe arrays as type:"array" with an items shape.
    const r = new McpRegistry();
    r.register({
      name: "product.create_listing",
      description: "",
      scope: "seller:product:write",
      auditEvent: "x",
      idempotent: false,
      inputSchema: z.object({
        sellerId: z.string(),
        variants: z.array(z.object({ sku: z.string() })).min(1),
        media: z.array(z.object({ url: z.string() })).min(1).max(20),
      }),
      outputSchema: z.object({}),
      handler: async () => ({}),
    });
    const [tool] = r.list();
    const schema = tool!.inputSchema as {
      type?: string;
      properties?: Record<string, { type?: string; items?: { type?: string } }>;
    };
    expect(schema.type).toBe("object");
    expect(schema.properties?.variants?.type).toBe("array");
    expect(schema.properties?.variants?.items?.type).toBe("object");
    expect(schema.properties?.media?.type).toBe("array");
  });

  it("exposes a typed JSON Schema even when fields use Zod transforms", () => {
    // Regression for the 2026-05-13 production incident: product.create_listing
    // has `priceMinor: z.union([string,number]).transform(BigInt)` and a media
    // `.transform()` that re-adds contentType. Without `unrepresentable: "any"`
    // on z.toJSONSchema, those transforms cause the whole conversion to throw
    // and the registry falls back to `additionalProperties: true`, which makes
    // MCP clients serialize arrays as JSON strings.
    const r = new McpRegistry();
    r.register({
      name: "product.create_listing",
      description: "",
      scope: "seller:product:write",
      auditEvent: "x",
      idempotent: false,
      inputSchema: z.object({
        variants: z
          .array(
            z.object({
              sku: z.string(),
              priceMinor: z.union([z.string(), z.number()]).transform((v) => BigInt(v)),
            }),
          )
          .min(1),
        media: z.array(z.object({ url: z.string() }).transform((m) => m)).min(1),
      }),
      outputSchema: z.object({}),
      handler: async () => ({}),
    });
    const [tool] = r.list();
    const schema = tool!.inputSchema as {
      type?: string;
      additionalProperties?: boolean;
      properties?: Record<string, { type?: string }>;
    };
    expect(schema.type).toBe("object");
    expect(schema.properties?.variants?.type).toBe("array");
    expect(schema.properties?.media?.type).toBe("array");
  });
});
