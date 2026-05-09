# Marketplace App

API-first marketplace for AI agents. This repo is a TypeScript monorepo organized
around an HTTP API (`@marketplace/api`), a Model Context Protocol tool surface
(`@marketplace/mcp-server`), an Agent-to-Agent skill server (`@marketplace/a2a-server`),
shared domain logic (`@marketplace/domain`), DB schema (`@marketplace/db`), and an
in-process simulation harness (`@marketplace/agent-sim`).

The high-level spec lives in `SPEC.md`. End-to-end scenarios are in `scenarios/`.

## Production deployment

| | |
|---|---|
| Web | https://teno-store.com (www → 301 → apex) |
| API | https://api.teno-store.com (`/livez` → `{"status":"ok"}`) |
| Domain registrar / DNS | Cloudflare (proxied, orange cloud) — see [`deploy/dns.md`](./deploy/dns.md) |
| Server | `vps-eu` — netcup VPS, Nuremberg DE, Debian 13 arm64, IPv4 `152.53.147.77` |
| Stack | Caddy + Next.js (web) + Fastify (api) + Postgres 17 + pgvector, Docker Compose |
| TLS | Let's Encrypt via Caddy (apex + www + api) |

Full operational docs — server inventory, DNS records, runbooks, change log,
current status — live in [`deploy/`](./deploy/). Start with
[`deploy/STATUS.md`](./deploy/STATUS.md) for a snapshot, then
[`deploy/README.md`](./deploy/README.md) for the index.

### Test the live site as a public visitor (no login)

Everything below is reachable anonymously — no account, no API key.

In a browser:

| URL | What you should see |
| --- | --- |
| https://teno-store.com/ | Landing page: "Watch your agent shop, in real time." |
| https://teno-store.com/search | Catalog grid — 17 seeded products in DZD across 5 Algerian sellers |
| https://teno-store.com/sitemap.xml | XML sitemap with apex + `/search` + every product detail URL (~19 entries today) |
| https://teno-store.com/robots.txt | Allows Googlebot + GPTBot/ClaudeBot/PerplexityBot/anthropic-ai |

From a terminal:

```bash
# API health
curl https://api.teno-store.com/livez
# → {"status":"ok"}

# Public catalog — no auth required
curl "https://api.teno-store.com/v1/products?limit=5"

# Single product (substitute a productId from the list above)
curl https://api.teno-store.com/v1/products/<productId>
```

Expected on a healthy day: ~17 products, currency `DZD`, sellers in Algiers /
Oran / Constantine / Annaba / Sétif. If the catalog comes back empty, the seed
has been wiped — re-run [runbook 06](./deploy/runbooks/06-seed-catalog.md).

If `https://teno-store.com/` hangs from your machine but `https://api.teno-store.com/`
works, your network's IPv6 path to Cloudflare is broken — retry with `curl --ipv4`
or a browser that falls back to IPv4 cleanly.

## Requirements

- Node.js >= 22
- pnpm >= 10 (the repo enforces `only-allow pnpm`)

## Install

```bash
pnpm install
```

## Common commands

| Command            | What it does                                          |
| ------------------ | ----------------------------------------------------- |
| `pnpm typecheck`   | Type-checks every package (uses TS project refs).     |
| `pnpm build`       | Compiles every package to `dist/`.                    |
| `pnpm test`        | Runs every package's vitest suite.                    |
| `pnpm dev:api`     | Starts the dev HTTP server (see below).               |
| `pnpm demo`        | One-shot end-to-end demo against the dev server.      |

## Test scenario: create account, create products, list them

There are two ways to run this. Use the simulation path for the validated business
logic; use the HTTP path if you want to actually hit a running server.

### Option A — in-process simulation (no server)

The repo's `agent-sim` package has full lifecycle scenarios — seller onboarding,
buyer purchase, dispute, etc. — written as vitest tests that exercise the same
domain code as the real HTTP/MCP/A2A surfaces.

```bash
pnpm --filter @marketplace/agent-sim test
```

You should see 36 tests pass across 6 files (seller onboarding, buyer purchase,
buyer full lifecycle, dispute, auction, negotiate-and-buy).

### Option B — live HTTP server + demo script

Two terminals:

**Terminal 1** — start the API:

```bash
pnpm dev:api
# → Marketplace API ready at http://127.0.0.1:3100
```

**Terminal 2** — run the demo:

```bash
pnpm demo
```

The demo:

1. checks `/livez`
2. `POST /v1/sellers` to create an account
3. `POST /v1/products` twice to create two products
4. `GET /v1/products?q=acme` to list them

It prints the full request/response JSON for each step.

To exercise the same flow by hand with curl, replace `<KEY>` with any 8–128
character idempotency key:

```bash
curl -sS -X POST http://127.0.0.1:3100/v1/sellers \
  -H "content-type: application/json" \
  -H "idempotency-key: demo-seller-aaaa1111" \
  -d '{"displayName":"Acme Widgets"}'

# pluck "sellerId" out of the response, then:

curl -sS -X POST http://127.0.0.1:3100/v1/products \
  -H "content-type: application/json" \
  -H "idempotency-key: demo-prd-aaaa1111" \
  -d '{"sellerId":"<SELLER_ID>","title":"Sprocket A","brand":"Acme",
       "variants":[{"sku":"SPR-A-1","priceMinor":1999,"currency":"USD"}]}'

curl -sS "http://127.0.0.1:3100/v1/products?q=acme"
```

## Dev server caveats

`pnpm dev:api` enforces the full passport + DPoP auth flow:

- Every non-health request must carry `Authorization: DPoP <token>`, a fresh
  `dpop:` proof header, and an `x-mp-passport:` header containing a signed
  Agent Passport JWT. The principal (agentId, scopes, owner, spend caps) is
  derived from the verified passport claims; the DPoP key thumbprint must
  match the passport's `cnf.jwk` thumbprint.
- The issuer's public key is loaded from
  `../minimal-issuer/keys/issuer.json` (override with `ISSUER_KEYS_PATH`).
  Run `node issuer.mjs init` in that folder once before starting the API.
- The store is **in-memory only** — restart wipes everything.
- POST endpoints (`/v1/sellers`, `/v1/products`) exist only when a `MemoryStore`
  is wired in. They are not part of the production HTTP surface in `SPEC.md` §5.

See `../minimal-issuer/README.md` for an end-to-end example of minting a
passport and calling the API.

## End-user (human) sign-in: Google OAuth

The API supports **optional** Google sign-in for end users. Public actions —
browsing the catalog, adding to cart, checkout, viewing your own order — work
**without** logging in. Logging in lets a user view all their past orders and
mint Agent Passports for agents acting on their behalf.

### One-time Google Cloud setup

1. In the Google Cloud console → APIs & Services → Credentials → **Create
   Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins** — add every origin that will call
   `google.accounts.id.initialize` and POST the resulting ID token to
   `/v1/auth/google`. Examples:
   - `http://localhost:3100` (this API for direct testing)
   - `http://localhost:3000` (a future local frontend)
   - `https://<your-prod-domain>`
4. **Authorized redirect URIs** — leave empty (we use the ID-token flow, not
   server-side redirects).
5. Copy the resulting **Client ID** into `.env` as `GOOGLE_CLIENT_ID`.
   *No client secret is needed for this flow.*

### Login flow

1. Caller (host UI) signs the user in with Google Identity Services and obtains
   an ID token.
2. `POST /v1/auth/google` with body `{"idToken": "<google id token>"}`.
3. Server verifies the token against Google's JWKS, upserts the user, and
   returns `{sessionJwt, expiresIn, user}`.
4. Caller passes `Authorization: Bearer <sessionJwt>` on subsequent requests.

| Endpoint | Auth |
| --- | --- |
| `GET /v1/products`, `GET /v1/products/:id` | none |
| `GET/POST/PATCH/DELETE /v1/cart*` | none (anonymous via `x-mp-cart-id`) or session |
| `POST /v1/checkout/quote`, `POST /v1/checkout/confirm` | none (guest checkout) |
| `GET /v1/orders/:id` | session **or** `x-mp-order-token` |
| `GET /v1/orders` (list own) | session |
| `POST /v1/auth/google` | none (this *is* the login) |
| `GET /v1/auth/me`, `POST /v1/auth/passports` | session |
| `POST /v1/sellers`, `POST /v1/products` | Agent Passport + DPoP |

## Docker

```bash
cp .env.example .env
# edit .env, set GOOGLE_CLIENT_ID

docker compose up --build
# → http://localhost:3100
```

The image is built without `.env` (excluded by `.dockerignore`); compose mounts
the file at runtime via `env_file:` and the `dotenv` package re-reads it inside
the process. The issuer keys at `../minimal-issuer/keys/issuer.json` are mounted
read-only into the container.

## Repo layout

```
packages/
  shared/      # logger, errors, ids, time, money — pure utilities
  db/          # drizzle schema, migrate/seed scripts
  domain/      # business logic: catalog, identity, payment, auctions, etc.
  mcp-server/  # MCP tool registry + tool definitions
  a2a-server/  # A2A skill registry + skill definitions
  api/         # Fastify HTTP edge — dev/demo surface lives here
  agent-sim/   # in-process scenario harness (the "tests as scenarios")
  test-utils/  # shared test helpers
scenarios/     # human-readable scenario descriptions (SOP-style)
SPEC.md        # high-level spec
OPEN_QUESTIONS.md  # backlog of open design questions
```

## Troubleshooting

- **Port 3100 in use** → `PORT=4000 pnpm dev:api`.
- **`Idempotency-Key` validation error** → POST endpoints require a header named
  `idempotency-key` between 8 and 128 characters.
- **Build fails after pulling** → `rm -rf packages/*/dist && pnpm build`.
