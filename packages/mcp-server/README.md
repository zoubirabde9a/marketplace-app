# @marketplace/mcp-server

Model Context Protocol surface — exposes the marketplace as MCP **tools** so
any MCP-compatible agent (Claude, GPT, Gemini, custom) can browse, transact,
and resolve disputes without ever touching a screen.

Built on `@modelcontextprotocol/sdk` 1.29.

## For operators (humans connecting an MCP-capable assistant)

If you are a seller pointing Claude / GPT / a custom agent at this MCP and want
to create a shop and list products, read this section before your first call.

### The ownership model (read this first)

Every shop created through the MCP is owned by the **agent identity** that
called it (e.g. `agt_local_operator`, your IDE's agent passport, etc.), not
by your web-login user account on `teno-store.com`.

Concretely, that means:

- Shops you create here are real, public, and reachable at the `storeUrl`
  returned by `seller.create_account`. Buyers can browse them; you can keep
  adding products via MCP.
- They will **not** appear under "My stores" / "My products" when you log
  into the website with email + password. There is no agent↔user linking
  flow yet — it is on the roadmap, but today the two worlds are separate.
- If you want a shop you can manage from the website AND from an agent,
  today you need two shops, or pick one channel.

When in doubt, keep the `sellerId` and `storeUrl` your agent prints back —
those are how you find the shop again later.

### Minimal flow (what to ask your agent for)

1. "Create a seller called *<name>*, country DZ, phone +213…" — the agent
   calls `seller.create_account`. Save the returned `sellerId` and
   `storeUrl`.
2. "Publish a product titled *<title>* under that seller, price X DZD,
   image at <url>" — the agent calls `product.create_listing` with the
   same `sellerId`. Save the returned `productUrl`.
3. Open `productUrl` in a browser to confirm what buyers will see.

### Common confusions

- **"I don't see my product on my account page."** Expected. See the
  ownership model above. Open the `productUrl` the agent returned.
- **"My agent created a 'Random Test Shop' I didn't ask for."** The agent
  invented a name because you didn't supply one. Always give the agent the
  exact display name, country, and phone you want; the tool descriptions
  explicitly tell the agent to ask if any of these are missing.
- **"The image doesn't show on the listing."** The catalog stores image
  *URLs*, not bytes. The URL must stay publicly fetchable forever — don't
  pass localhost paths, signed S3 links that expire, or images behind a
  login wall.

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
