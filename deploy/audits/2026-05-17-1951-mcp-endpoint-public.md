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
