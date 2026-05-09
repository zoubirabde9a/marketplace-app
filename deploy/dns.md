# DNS

Authoritative record of which domains we own, where DNS is managed, and how each name maps to our servers. Keep this in sync with reality — if a record is changed in the Cloudflare dashboard, update this file and add a `CHANGELOG.md` entry.

## Domains

| Domain | Registrar | DNS provider | Cloudflare nameservers | Notes |
|---|---|---|---|---|
| `teno-store.com` | TBD (record from registrar invoice) | Cloudflare (Free plan) | `benedict.ns.cloudflare.com`, `rosemary.ns.cloudflare.com` | Production domain for the marketplace app. Pointed at `vps-eu`. |

## `teno-store.com` — records (verified 2026-05-08)

All records point at `vps-eu` (`152.53.147.77` / `2a0a:4cc0:c1:2d20:a816:a4ff:fe07:7870`). All are **proxied** (orange cloud) so the public sees Cloudflare IPs, not the origin.

| Type | Name | Content | Proxy | Purpose |
|---|---|---|---|---|
| `A` | `@` | `152.53.147.77` | 🟠 Proxied | Apex → `vps-eu` |
| `AAAA` | `@` | `2a0a:4cc0:c1:2d20:a816:a4ff:fe07:7870` | 🟠 Proxied | Apex IPv6 |
| `A` | `www` | `152.53.147.77` | 🟠 Proxied | `www.teno-store.com` |
| `AAAA` | `www` | `2a0a:4cc0:c1:2d20:a816:a4ff:fe07:7870` | 🟠 Proxied | `www` IPv6 |
| `A` | `api` | `152.53.147.77` | 🟠 Proxied | API subdomain (Caddy will route to Fastify on port 3100) |
| `AAAA` | `api` | `2a0a:4cc0:c1:2d20:a816:a4ff:fe07:7870` | 🟠 Proxied | `api` IPv6 |

**Not yet configured (and intentionally so):**
- No `MX` / `SPF` / `DKIM` / `DMARC` — we don't send email from this domain. If we add email later, MX records must be **grey-cloud** (Cloudflare doesn't proxy SMTP).
- No `CAA` record — optional; would restrict cert issuance to Let's Encrypt only.

## Cloudflare account settings

| Setting | Path in dashboard | Current value | Target value |
|---|---|---|---|
| SSL/TLS encryption mode | SSL/TLS → Overview | **Full** (bootstrap) | **Full (strict)** — flip after Caddy issues its first Let's Encrypt cert in runbook 05 |
| Always Use HTTPS | SSL/TLS → Edge Certificates | ON | ON |
| Automatic HTTPS Rewrites | SSL/TLS → Edge Certificates | ON | ON |
| Minimum TLS Version | SSL/TLS → Edge Certificates | 1.2 | 1.2 |
| `www → apex` redirect | Rules → Redirect Rules | configured (301, preserve query) | same |
| Bot Fight Mode | Security → Settings | ON | ON |

## Why `Full` and not `Full (strict)` yet

- **Flexible** = Cloudflare ↔ origin is plain HTTP. Insecure and breaks Caddy's auto-HTTPS. Never use.
- **Full** = encrypted to origin, accepts self-signed/expired certs at the origin. Safe to use during bootstrap when Caddy hasn't gotten its real cert yet.
- **Full (strict)** = encrypted to origin **and** the origin cert must be valid + match the hostname. This is the correct end state once Caddy has a Let's Encrypt cert for `teno-store.com` / `www` / `api`.

The upgrade from `Full` → `Full (strict)` is a single dropdown change after runbook 05 is done.

## Caddy + Cloudflare proxy interaction

The orange cloud puts Cloudflare in front of Caddy. Two implications worth knowing:

1. **Origin sees Cloudflare IPs as the client.** Real visitor IP is in the `CF-Connecting-IP` header. Caddy's `trusted_proxies` directive should be set to Cloudflare's published IP ranges so Caddy logs the real client IP instead of the Cloudflare edge.
2. **Let's Encrypt HTTP-01 challenge:** Cloudflare passes through `/.well-known/acme-challenge/*` requests, so HTTP-01 works through the orange cloud. If it ever doesn't, the workarounds are: (a) temporarily grey-cloud the records while Caddy bootstraps the cert, then re-orange; or (b) switch Caddy to DNS-01 using a Cloudflare API token.

## Verification

From any machine:

```powershell
nslookup teno-store.com 1.1.1.1
nslookup www.teno-store.com 1.1.1.1
nslookup api.teno-store.com 1.1.1.1
```

Expected: all three return Cloudflare IPs (`104.21.x.x` / `172.67.x.x` and `2606:4700:*`). If they return `152.53.147.77` directly, the proxy is OFF — re-check the orange cloud toggle in the Cloudflare dashboard.

Last verified: **2026-05-08** — proxy active, all three names resolving via Cloudflare.
