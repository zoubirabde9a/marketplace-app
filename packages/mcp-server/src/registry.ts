// MCP tool registry with scope-checking, audit emission, and idempotency wrappers.

import { z, type ZodType } from "zod";
import { ForbiddenError } from "@marketplace/shared/errors";
import { createLogger } from "@marketplace/shared/logger";
import { newId } from "@marketplace/shared/ids";

const log = createLogger("mcp-registry");

export interface McpContext {
  agentId: string;
  passportId: string;
  scopes: ReadonlySet<string>;
  ownerKind: "user" | "org";
  ownerId: string;
  mandateId?: string;
  requestId: string;
  now: () => number;
  emitAudit: (event: AuditEvent) => Promise<void>;
}

export interface AuditEvent {
  agentId: string;
  passportId: string;
  toolName: string;
  scope: string;
  status: "ok" | "denied" | "error";
  latencyMs: number;
  inputHash: string;
  outputHash?: string;
  errorCode?: string;
}

export interface McpToolDef<I, O> {
  name: string;
  description: string;
  scope: string;
  auditEvent: string;
  idempotent: boolean;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  examples?: Array<{ input: I; output: O; description: string }>;
  errorCatalog?: ReadonlyArray<{ code: string; httpStatus: number; description: string }>;
  handler: (input: I, ctx: McpContext) => Promise<O>;
}

export class McpRegistry {
  private readonly tools = new Map<string, McpToolDef<unknown, unknown>>();

  register<I, O>(def: McpToolDef<I, O>): void {
    if (this.tools.has(def.name)) throw new Error(`mcp_tool_already_registered:${def.name}`);
    if (!def.name.match(/^[a-z][a-z_]*\.[a-z][a-z_]*$/)) {
      throw new Error(`mcp_tool_name_must_be_noun_verb:${def.name}`);
    }
    this.tools.set(def.name, def as unknown as McpToolDef<unknown, unknown>);
    log.info({ tool: def.name, scope: def.scope }, "mcp_tool_registered");
  }

  list(): Array<{ name: string; description: string; scope: string; inputSchema: unknown; idempotent: boolean }> {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      scope: t.scope,
      idempotent: t.idempotent,
      inputSchema: schemaToJsonSchema(t.inputSchema),
    }));
  }

  async invoke(name: string, rawInput: unknown, ctx: McpContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`mcp_tool_not_found:${name}`);

    if (!ctx.scopes.has(tool.scope)) {
      await ctx.emitAudit({
        agentId: ctx.agentId,
        passportId: ctx.passportId,
        toolName: name,
        scope: tool.scope,
        status: "denied",
        latencyMs: 0,
        inputHash: hash(rawInput),
        errorCode: "missing_scope",
      });
      throw new ForbiddenError(`missing_scope:${tool.scope}`);
    }

    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`mcp_input_validation:${parsed.error.message}`);
    }

    const start = ctx.now();
    try {
      const out = await tool.handler(parsed.data, ctx);
      const validated = tool.outputSchema.parse(out);
      await ctx.emitAudit({
        agentId: ctx.agentId,
        passportId: ctx.passportId,
        toolName: name,
        scope: tool.scope,
        status: "ok",
        latencyMs: ctx.now() - start,
        inputHash: hash(rawInput),
        outputHash: hash(validated),
      });
      return validated;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errCode = errMsg.split(":")[0]!;
      await ctx.emitAudit({
        agentId: ctx.agentId,
        passportId: ctx.passportId,
        toolName: name,
        scope: tool.scope,
        status: "error",
        latencyMs: ctx.now() - start,
        inputHash: hash(rawInput),
        errorCode: errCode,
      });
      throw err;
    }
  }
}

function hash(v: unknown): string {
  // Lightweight content hash without pulling crypto into hot path.
  // Bigints serialise as `"<n>n"` so audits don't crash on monetary amounts.
  const replacer = (_k: string, val: unknown) => (typeof val === "bigint" ? `${val}n` : val);
  const s = typeof v === "string" ? v : JSON.stringify(v ?? null, replacer);
  let h = 5381n;
  for (let i = 0; i < s.length; i++) h = ((h << 5n) + h + BigInt(s.charCodeAt(i))) & 0xffffffffffffffffn;
  return h.toString(16).padStart(16, "0");
}

function schemaToJsonSchema(schema: ZodType): unknown {
  // The MCP TS SDK validates tools/list responses and rejects entries without a
  // valid JSON Schema object. We don't have zod-to-json-schema in deps, so we
  // emit a permissive object schema that the SDK accepts. The handler still
  // calls schema.safeParse() so input validation isn't lost.
  return {
    type: "object",
    additionalProperties: true,
    ...(typeof (schema as unknown as { description?: string })?.description === "string"
      ? { description: (schema as unknown as { description?: string }).description }
      : {}),
  };
}

export { z };
export const newRequestId = (): string => newId("req");
