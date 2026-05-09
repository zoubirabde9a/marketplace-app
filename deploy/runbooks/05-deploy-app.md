# Runbook 05 — Deploy the marketplace app to `vps-eu`

**Status:** ready to execute. Runbooks 01–04 complete. DNS at Cloudflare points `teno-store.com`, `www`, and `api` at `vps-eu` (proxied).

**Goal:** bring up `caddy + web + api + postgres` on `vps-eu` so that:
- `https://teno-store.com` serves the Next.js observer
- `https://api.teno-store.com/v1/...` serves the Fastify API
- TLS is automatically issued by Caddy via Let's Encrypt
- The stack survives reboots (`restart: unless-stopped`)

---

## 0. Prerequisites (manual — required before running)

Two values must exist in `/opt/marketplace/.env` on the server. They are NOT in this repo, NOT in `deploy/.env`, and NOT generated automatically:

| Var | How to get it |
|---|---|
| `POSTGRES_PASSWORD` | Generate a strong random one: `openssl rand -base64 32`. Keep a copy in `deploy/.env` as `VPS_EU_POSTGRES_PASSWORD` for traceability. |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials → "Create OAuth client ID" (Web application). Authorized redirect URIs: `https://teno-store.com/api/seller/session`. |

Optional but recommended:
- `AUDIENCE=marketplace.teno-store.com` (JWT audience claim).

---

## 1. Push the repo to the server

From the operator workstation, with the repo at `C:\Users\mahll\Documents\workspace\new-projects\marketplace-app`:

```powershell
# rsync via ssh (uses the vps-eu alias). Excludes node_modules and local .env.
ssh vps-eu "mkdir -p /opt/marketplace && chmod 700 /opt/marketplace"

# WSL or Git Bash recommended for rsync; on plain PowerShell use scp -r instead.
rsync -avz --delete `
  --exclude node_modules `
  --exclude .next `
  --exclude .env `
  --exclude .env.bak `
  --exclude .git `
  --exclude deploy/.env `
  --exclude '**/dist' `
  --exclude '**/.tsbuildinfo' `
  ./ vps-eu:/opt/marketplace/
```

Plain-PowerShell fallback (no rsync):

```powershell
scp -r -o "KexAlgorithms=curve25519-sha256" `
  Caddyfile docker-compose.prod.yml Dockerfile .dockerignore `
  package.json pnpm-lock.yaml pnpm-workspace.yaml `
  tsconfig.base.json tsconfig.json `
  packages minimal-issuer scripts `
  vps-eu:/opt/marketplace/
```

---

## 2. Create the server-side `.env`

```bash
ssh vps-eu
cd /opt/marketplace

# Generate a strong DB password; record it in deploy/.env on the operator side.
DB_PASS=$(openssl rand -base64 32 | tr -d '/+' | cut -c1-32)
echo "Postgres password: $DB_PASS"   # copy to deploy/.env on your laptop

cat > .env <<EOF
# Server-side runtime secrets for /opt/marketplace.
# Never commit. Mode 600, owner root.

POSTGRES_PASSWORD=$DB_PASS

# Public URL — must match what users type in the browser. Used for canonical
# URLs, OG tags, and the sitemap's host field.
NEXT_PUBLIC_SITE_URL=https://teno-store.com

# Google OAuth client ID for the seller dashboard sign-in.
GOOGLE_CLIENT_ID=

# Issuer key path inside the api container.
ISSUER_KEYS_PATH=/app/minimal-issuer/keys/issuer.json

# JWT audience claim.
AUDIENCE=marketplace.teno-store.com

# Logging.
LOG_LEVEL=info
NODE_ENV=production

# DEV_BYPASS must NEVER be 1 in production.
DEV_BYPASS=0
EOF

chmod 600 .env
```

Edit the file in-place to fill `GOOGLE_CLIENT_ID`.

---

## 3. Prepare Postgres host bind-mount

```bash
mkdir -p /var/lib/marketplace/postgres
chmod 700 /var/lib/marketplace/postgres
# Postgres in the container runs as UID 999 (postgres). Host path needs to be
# writable by that UID — Docker handles ownership on first run.
```

---

## 4. Bring up the stack

```bash
cd /opt/marketplace
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=100
```

First start takes 2–5 min: builds the API + web images, then Caddy negotiates Let's Encrypt for `teno-store.com`, `www.teno-store.com`, and `api.teno-store.com`.

**If Caddy can't get certs through Cloudflare's proxy** (HTTP-01 challenge fails), see `deploy/dns.md` § "Caddy + Cloudflare proxy interaction" — workaround is to grey-cloud the records temporarily, let Caddy issue the cert, then re-orange.

---

## 5. Run database migrations

```bash
cd /opt/marketplace
docker compose -f docker-compose.prod.yml exec api node -e "console.log('placeholder — replace with: pnpm --filter @marketplace/db db:migrate via the api container')"
```

(TODO: confirm the migration command shape in `packages/db` and update this step. Drizzle's recommended pattern is to bake `drizzle-kit migrate` into a one-shot job, or run it as part of API startup.)

---

## 6. Verify

From the operator workstation:

```powershell
# TLS handshake + cert fingerprint (expect Let's Encrypt R3 issuer)
curl -vI https://teno-store.com/
curl -vI https://api.teno-store.com/livez

# Web returns 200, has the right canonical
curl -s https://teno-store.com/ | Select-String "<title>|canonical|teno-store"

# API liveness
curl -s https://api.teno-store.com/livez

# AI/SEO discoverability
curl -s https://teno-store.com/robots.txt
curl -s https://teno-store.com/sitemap.xml
curl -s https://teno-store.com/llms.txt
curl -s https://teno-store.com/.well-known/agents.json | ConvertFrom-Json
```

In a browser:
- Visit `https://teno-store.com/` — observe Caddy-issued cert (DigiCert / Let's Encrypt), home page renders.
- Visit `https://teno-store.com/search` — search page renders (may be empty if catalog has no products yet).

---

## 7. Flip Cloudflare to "Full (strict)"

After `curl https://teno-store.com/` returns 200 with a Let's Encrypt cert, in the Cloudflare dashboard:

- SSL/TLS → Overview → set encryption mode to **Full (strict)**.
- Verify `https://teno-store.com/` still works.
- Update `deploy/dns.md` and add a `CHANGELOG.md` entry.

---

## 8. Submit to search engines / register with AI providers

- [Google Search Console](https://search.google.com/search-console) — add property `teno-store.com`, verify via DNS TXT record (Cloudflare), submit `https://teno-store.com/sitemap.xml`.
- [Bing Webmaster Tools](https://www.bing.com/webmasters/) — same.
- Test: [Google Rich Results Test](https://search.google.com/test/rich-results) on a product URL — confirms the `Product` JSON-LD parses cleanly.

---

## 9. Add monitoring + backups (defer if needed)

- UptimeRobot monitor on `https://api.teno-store.com/livez` — 5-min interval, email alerts.
- Nightly cron: `pg_dump` → restic → Backblaze B2 (see `protocols.md` § Backups).

Update `deploy/CHANGELOG.md` and tick the runbook checkbox in `servers.md` once §1–8 are green.
