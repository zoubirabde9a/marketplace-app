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
  app.post("/mcp", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as JsonRpcRequest;
    if (body?.jsonrpc !== "2.0" || !body.method) {
      return reply.code(400).send({
        jsonrpc: "2.0",
        id: body?.id ?? null,
        error: { code: -32600, message: "invalid_request" },
      } satisfies JsonRpcResponse);
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
          result = { content: [{ type: "json", json: out }], isError: false };
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
