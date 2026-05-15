// Streamable-HTTP MCP transport for Fastify.
// Implements the JSON-RPC 2.0 frame the MCP TS SDK expects.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MarketplaceError } from "@marketplace/shared/errors";
import type { McpRegistry, McpContext } from "./registry.js";
import { newRequestId } from "./registry.js";

// Map a MarketplaceError's HTTP status to a JSON-RPC error code. The spec
// reserves -32600..-32603 for protocol errors; -32000..-32099 are server-
// defined. We use the well-known -32602 for "Invalid params" (validation,
// 400) and the server-defined band for everything else so clients can
// distinguish a malformed call from a permission denial.
function jsonRpcCodeFor(status: number): number {
  if (status === 400) return -32602; // Invalid params
  if (status === 401) return -32001; // Unauthorized
  if (status === 403) return -32002; // Forbidden
  if (status === 404) return -32003; // Not found
  if (status === 409) return -32004; // Conflict
  if (status === 429) return -32005; // Rate limited
  return -32000; // Generic server-defined error
}

export interface McpTransportDeps {
  registry: McpRegistry;
  buildContext: (req: FastifyRequest) => Promise<McpContext>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export async function registerMcpTransport(app: FastifyInstance, deps: McpTransportDeps): Promise<void> {
  // Per MCP streamable-HTTP spec: a server with no server→client SSE channel
  // returns 405 to GET, and a stateless server returns 405 to DELETE. Without
  // these handlers Fastify 404s the verb, which the MCP TS SDK escalates to
  // an OAuth challenge → DCR → "auth failed".
  const methodNotAllowed = async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.code(405).header("allow", "POST").send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "method_not_allowed" },
    } satisfies JsonRpcResponse);
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.post("/mcp", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as JsonRpcRequest;
    if (body?.jsonrpc !== "2.0" || !body.method) {
      return reply.code(400).send({
        jsonrpc: "2.0",
        id: body?.id ?? null,
        error: { code: -32600, message: "invalid_request" },
      } satisfies JsonRpcResponse);
    }

    // JSON-RPC notifications have no `id` and expect no response. Per the MCP
    // spec, the server returns 202 Accepted with an empty body. Examples:
    // `notifications/initialized`, `notifications/cancelled`, `notifications/progress`.
    if (body.id === undefined || body.method.startsWith("notifications/")) {
      return reply.code(202).send();
    }

    const ctx = await deps.buildContext(req);

    try {
      let result: unknown;
      switch (body.method) {
        case "initialize":
          result = {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "marketplace", version: "0.1.0" },
            capabilities: { tools: {} },
          };
          break;
        case "tools/list":
          result = { tools: deps.registry.list() };
          break;
        case "tools/call": {
          const params = body.params as { name: string; arguments?: unknown };
          if (!params?.name) throw new Error("invalid_params:name_required");
          const out = await deps.registry.invoke(params.name, params.arguments ?? {}, {
            ...ctx,
            requestId: ctx.requestId || newRequestId(),
          });
          // MCP spec content types: text | image | audio | resource. JSON-as-text
          // is the portable way to return a structured tool result; clients
          // (including the MCP TS SDK) parse the text on the caller side.
          const serialised = JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
          result = { content: [{ type: "text", text: serialised }], isError: false };
          break;
        }
        default:
          return reply.code(404).send({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32601, message: "method_not_found" },
          } satisfies JsonRpcResponse);
      }
      return reply.send({ jsonrpc: "2.0", id: body.id, result } satisfies JsonRpcResponse);
    } catch (err) {
      // Domain errors carry their own HTTP status (400/401/403/404/409 …);
      // surface that to the client rather than collapsing every failure to
      // 500. Returning 500 for a permission denial or a validation failure
      // triggers SDK retry/backoff loops that can't fix the underlying issue
      // and floods the audit log with phantom 500s.
      if (err instanceof MarketplaceError) {
        const data =
          Object.keys(err.extensions).length > 0 ? { extensions: err.extensions } : undefined;
        return reply.code(err.status).send({
          jsonrpc: "2.0",
          id: body.id,
          error: {
            code: jsonRpcCodeFor(err.status),
            message: err.message,
            ...(data ? { data } : {}),
          },
        } satisfies JsonRpcResponse);
      }
      // Generic-error fallback. Pre-fix the raw `err.message` was echoed to
      // the client — for an unhandled error that's typically database
      // schema text ("duplicate key value violates unique constraint
      // \"sellers_pkey\""), a Node.js internal message ("Cannot read
      // properties of undefined …"), or an internal service URL
      // ("ECONNREFUSED 10.0.0.5:5432"). Each leaks platform internals
      // useful to a fingerprinting attacker. Log the detail server-side
      // (so on-call still sees what broke) but return a stable, generic
      // string. MarketplaceError above already carries its own
      // intentionally-public messages so callers still get actionable
      // 400/403/404 detail.
      req.log.error({ err, method: body.method }, "mcp_unhandled_error");
      return reply.code(500).send({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32603, message: "internal_server_error" },
      } satisfies JsonRpcResponse);
    }
  });
}
