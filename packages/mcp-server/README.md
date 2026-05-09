# @marketplace/mcp-server

Model Context Protocol surface — exposes the marketplace as MCP **tools** so
any MCP-compatible agent (Claude, GPT, Gemini, custom) can browse, transact,
and resolve disputes without ever touching a screen.

Built on `@modelcontextprotocol/sdk` 1.29.

## Layout

```
src/
├── server.ts      # MCP server factory — registers tools, wires transport
├── registry.ts    # Tool registry: name → { schema, handler }
├── transport.ts   # Streamable HTTP transport adapter
├── tools/         # One file per tool (search_products, place_order, …)
└── index.ts       # Public exports
```

Each tool is a thin adapter over `@marketplace/domain` — same rule as the HTTP
edge: parse, authorize, delegate.

## Tool surface

The full tool catalog and schemas are in [`../../SPEC.md`](../../SPEC.md) §6.
Source of truth at runtime is `registry.ts` — every tool registered there is
discoverable via the standard MCP `tools/list` request.

## Auth

MCP requests carry the same Agent Passport + DPoP envelope as the HTTP edge.
The transport adapter in `transport.ts` extracts headers from the streamable
HTTP frame and runs the same verification path as the API package, so the
authorization model is identical.

## Running

```sh
pnpm --filter @marketplace/mcp-server dev     # tsx watch
pnpm --filter @marketplace/mcp-server start   # built artifact
pnpm --filter @marketplace/mcp-server test
```

## Adding a tool

1. Create `src/tools/<name>.ts` exporting `{ name, schema, handler }`.
2. Register in `src/registry.ts`.
3. Schema is Zod; the registry converts it to the JSON Schema MCP requires.
4. Handler receives the verified principal and a typed input — call into
   `@marketplace/domain` and return the tool result.
5. Add a vitest unit test plus a contract example in `SPEC.md` §6.
