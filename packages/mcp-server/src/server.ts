// MCP server scaffolding — concrete tool registration lands in task #5.
//
// Transport: Streamable HTTP at /mcp (per spec §5.2)
// Auth: OAuth 2.1 + DPoP (validated by edge gateway via API package middleware)
// Tool naming convention: noun.verb (e.g. catalog.search, cart.add_item)

import { createLogger } from "@marketplace/shared/logger";

const log = createLogger("mcp-server");

export interface McpToolDef<TIn = unknown, TOut = unknown> {
  name: string;
  description: string;
  scope: string;
  auditEvent: string;
  idempotent: boolean;
  inputSchema: unknown; // JSON Schema (zod → JSON Schema in concrete impl)
  handler: (input: TIn, ctx: McpContext) => Promise<TOut>;
}

export interface McpContext {
  agentId: string;
  passportId: string;
  scopes: ReadonlySet<string>;
  mandateId?: string;
  requestId: string;
}

export const TOOL_REGISTRY = new Map<string, McpToolDef>();

export function registerTool<I, O>(def: McpToolDef<I, O>): void {
  if (TOOL_REGISTRY.has(def.name)) {
    throw new Error(`MCP tool already registered: ${def.name}`);
  }
  TOOL_REGISTRY.set(def.name, def as unknown as McpToolDef);
  log.info({ tool: def.name, scope: def.scope }, "Registered MCP tool");
}

export async function startMcpServer(): Promise<void> {
  log.info({ tools: TOOL_REGISTRY.size }, "MCP server scaffold ready");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer();
}
