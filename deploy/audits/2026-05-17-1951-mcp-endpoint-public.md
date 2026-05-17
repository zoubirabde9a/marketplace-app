# Audit: `/mcp` endpoint is publicly reachable on `api.teno-store.com`

- **Detected:** 2026-05-17 19:51 local
- **Severity:** low (informational) — possibly intentional, possibly an unattended attack surface
- **Source:** api access log

## Evidence

```
GET /mcp  host=api.teno-store.com  remoteAddress=105.101.195.147  → 405  6.95 ms
```

Three requests to `/mcp` were also seen in the 19:47 caddy sample (separate IPs). The api returns 405 (method not allowed for GET) but does not reject the host or path outright, which means an MCP server is mounted on the public API. The 405 indicates the route is registered — only the verb was wrong.

## Hypothesis

The Model Context Protocol server (for AI agent integration) is exposed on the same hostname as the public store API. If it's gated by an auth header, a GET probe should return 401, not 405 — the 405 suggests the route is open for the right method (POST). That isn't necessarily a vulnerability (MCP endpoints often legitimately accept unauth'd POST and validate inside), but it is an attack surface that should be intentional and rate-limited.

## Fix steps

1. Confirm: is `/mcp` supposed to be reachable from the public internet, or is it intended for an internal/authenticated caller only?
   - If internal-only: gate it in Caddy by IP allowlist, or move it to an unannounced hostname (e.g. `mcp.internal.teno-store.com`) behind Cloudflare Access.
   - If public-by-design: add rate limits (Cloudflare WAF rule: `path = /mcp AND requests > 30/min` → challenge) and confirm the POST handler validates an auth token before doing real work.
2. Add structured logging at the MCP handler level so we can see who is calling it and what tools they are invoking. Without that we can't tell legitimate use from probing.
3. Independent of MCP: there is no HTTP rate limiting anywhere in front of api right now. Adding a generic 100 req/min/IP rule at the Cloudflare edge would catch this and the crawler from `2026-05-17-1947-aggressive-crawler-136-117-185-78.md` in one move.

## Similar issues to scan for

- Are there other `/internal/*` or `/admin/*` paths exposed on `api.teno-store.com`? Grep the API route table for any path that should not be public.
- The MCP tool list in this session (`mcp__teno-store__*`) suggests an in-house tool surface — make sure none of the *write* tools (`product_create_listing`, `seller_create_account`, `cart_*`, `checkout_confirm`) are reachable without auth.

---

## Resolved (verified) — 2026-05-17 20:30

Write-tool auth was traced end-to-end and confirmed enforced. The `/mcp` POST endpoint is intentionally public at the transport layer (so the MCP TS SDK can connect without OAuth/DCR), but every tool invocation runs through a scope check:

1. **Transport** (`packages/api/src/middleware/auth.ts:103`) marks `/mcp` as public — only `tools/list` and `initialize` succeed for an anonymous caller. Tool calls fall through to step 2.
2. **buildContext** (`packages/api/src/server.ts:308-322`) — when `req.principal` is absent, the MCP context is built with `scopes: new Set()` (empty). agentId = `"anonymous"`.
3. **Registry invoke** (`packages/mcp-server/src/registry.ts:73-84`) — every `tools/call` checks `ctx.scopes.has(tool.scope)` and throws `ForbiddenError("missing_scope:<scope>")` if absent. An anonymous caller has an empty scope set, so every scoped tool rejects.
4. **Tool scope tags verified** (`packages/mcp-server/src/tools/`):
   - `seller.create_account` → `seller:write`
   - `product.create_listing` → `seller:product:write`
   - `cart.*` (buyer.ts) → `buyer:cart:write` / `buyer:cart:read`
   - `checkout.confirm` (buyer.ts:515) → `buyer:checkout:write`
   - `order.get` → `buyer:order:read`
   - `seller.list_orders` → `seller:order:read`

Two promotion paths exist for `/mcp` (auth.ts:215-283):
- `DEV_BYPASS=1` — synthesises a dev principal with the full default scope bundle. **Verified off in production:** `vps-eu:/opt/marketplace/.env` has `DEV_BYPASS=0`.
- `X-Mp-Mcp-Token` header matching `MCP_ADMIN_TOKEN` — shared-secret admin path, constant-time-compared via `safeEqualString`. Token is a 64-char hex value set in `/opt/marketplace/.env` (mode 600).

The 405 the original probe observed is the spec-mandated response to GET `/mcp` (`packages/mcp-server/src/transport.ts:48-55`) — not an auth bypass. POST without a passport or admin token reaches the registry, which rejects on missing scope. **No write tool is reachable unauthenticated.**

Remaining suggestion from the original audit that is still actionable but separate from the auth gap: add a Cloudflare WAF rate limit on `/mcp` so anonymous probes can't exercise the scope-rejection path indefinitely. That is a CF dashboard change and needs the operator.
