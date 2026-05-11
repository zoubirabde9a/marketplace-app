// Streamable-HTTP MCP transport for Fastify.
// Implements the JSON-RPC 2.0 frame the MCP TS SDK expects.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { McpRegistry, McpContext } from "./registry.js";
import { newRequestId } from "./registry.js";

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
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32000, message },
      } satisfies JsonRpcResponse);
    }
  });
}
