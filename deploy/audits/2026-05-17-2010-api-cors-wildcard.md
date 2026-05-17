# Audit: `Access-Control-Allow-Origin: *` on `api.teno-store.com`

- **Detected:** 2026-05-17 20:10 local
- **Severity:** medium — depends on the API's auth model; wide-open today
- **Source:** `curl -sI https://api.teno-store.com/livez`

## Evidence

Response headers on the public API:

```
access-control-allow-origin: *
access-control-allow-methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
access-control-allow-headers: Content-Type, Authorization, DPoP, X-Mp-Agent-Id
access-control-max-age: 86400
```

The home page (`teno-store.com`) ships a CSP with `connect-src 'self' https://api.teno-store.com` — i.e. the legitimate frontend is the single intended caller from a browser context.

## Hypothesis

`*` on the API was probably set during early development to make it easy to call from any origin and never tightened. It's not the worst CORS posture (no `Access-Control-Allow-Credentials: true`, so browser cookies aren't sent cross-origin), but:

- Anything that authenticates via `Authorization: Bearer …` or the custom `DPoP` / `X-Mp-Agent-Id` headers will succeed cross-origin. If a user's token leaks into a malicious page (XSS on a third-party site, a phishing link), that page can call the full write surface of the API from the user's browser.
- The API allows `PUT/PATCH/DELETE` — i.e. state changes — from any origin.

## Fix steps

1. Replace `*` with an allowlist:
   ```
   Access-Control-Allow-Origin: <reflect the request origin if it matches one of:
     https://teno-store.com
     https://www.teno-store.com>
   Vary: Origin
   ```
   Apply in the API itself (Fastify CORS plugin / equivalent), not Caddy — the app knows which origins are legitimate.
2. If MCP (`/mcp`, see `2026-05-17-1951-mcp-endpoint-public.md`) is expected to be called from third-party agents, treat its CORS separately: gate it with auth, then either keep `*` or allowlist known agent origins.
3. Verify nothing downstream depends on the `*` (e.g. a partner integration). Search the frontend for hard-coded calls; grep server logs for the top non-`teno-store.com` `Origin` headers in the last 24 h.

## Similar issues to scan for

- The CSP on `teno-store.com` is `Content-Security-Policy-Report-Only` — meaning it logs violations but doesn't block. Once the page is known to be compliant, move it to enforce (`Content-Security-Policy`). Also: `script-src 'self' 'unsafe-inline' 'unsafe-eval'` defeats most of the CSP value; tightening that is a follow-up.
- Confirm there is no `Server` or `X-Powered-By` header leaking versions. (Quick check: `Server: Caddy` is fine; no Node/Next version leaked.)
- HSTS preload is set correctly on both hosts (`max-age=31536000; includeSubDomains; preload`) — good. If the domain is not yet on the HSTS preload list, this is the right config to apply for it.
