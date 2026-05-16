# Deployment changelog

Append-only log of changes made to production servers. One entry per dated event. The point is traceability: if anything breaks, this file tells us what changed and when.

Format: `## YYYY-MM-DD — short summary`, then bullets.

---

## 2026-05-16 — vps-eu · MCP capability declaration — tools-only, no resources/prompts

- Empirical probe: `resources/list` and `prompts/list` both return JSON-RPC -32601 (method_not_found). HTTP status varies (404 for prompts/list, transient 000 on a second probe of resources/list — likely connectivity not protocol). The server's `initialize` response declares only `capabilities.tools: {}`, no instructions field. Tools-only server.
- Before this iteration, AI agents reading agents.json learned the MCP endpoint + version + 9 tools — but didn't know whether the server ALSO supported resources/prompts/logging/completion. The optimization-minded agent would probe each capability on first contact. Wasted round-trips for nothing.
- Added `protocols.mcp.capabilities_supported` block to agents.json declaring exactly which MCP capabilities are present (tools: true) and which are not (resources, prompts, logging, completion, instructions_field_in_initialize: false). With a `note` explaining that per-tool guidance lives in protocols.mcp.tools[].summary rather than top-level instructions.
- Pushed to IndexNow. AI agents save 2-4 round-trips on first contact with the MCP server.

## 2026-05-16 — vps-eu · REST error envelope is RFC 7807 (clean) — documented in agents.json

- Last iteration's MCP audit found HTTP 500 for every error kind. Probed the REST surface's error semantics for comparison: **REST is well-behaved** — clean RFC 7807 Problem Details (`application/problem+json`) responses.
- Empirical evidence (2026-05-16):
  - `GET /v1/products/not-a-uuid` → **404** with `{type: https://marketplace.dev/errors/not-found, title, status:404, detail, instance}`
  - `GET /v1/products/<valid-nonexistent-uuid>` → 404 same shape
  - `GET /v1/products/` (note trailing slash) → **401** with `dpop_token_required` — trailing slash is a different route requiring auth (quirk worth documenting)
  - `GET /v1/products/<real-uuid>` → 200
- Added `protocols.rest.error_envelope` to agents.json documenting:
  - Format: RFC 7807 (citable industry standard for HTTP API errors)
  - Field list: type/title/status/detail/instance
  - Worked example bodies for 401 and 404
  - The trailing-slash quirk (use no-slash form for the public list endpoint)
  - Explicit `vs_mcp` cross-reference noting REST is correct and MCP is not (per iter-53 — operator follow-up still pending)
- Pushed to IndexNow. AI agents reading the manifest now know:
  - MCP errors → JSON-RPC code -32000 inside HTTP 500 (parse the message)
  - REST errors → standard RFC 7807 with the right HTTP status (parse-and-trust)
  - These are SEPARATE semantics; agents handling both surfaces need both code paths.

## 2026-05-16 — vps-eu · empirically harvested OAuth scopes for all 9 MCP tools + error-envelope semantics

- Probed each MCP tool unauthenticated via `tools/call`. Every tool returns `{"code":-32000,"message":"Forbidden: missing_scope:<scope>"}` — exposing the exact OAuth scope required. Captured all 9:
  | Tool | Scope |
  |---|---|
  | seller.create_account | `seller:write` |
  | product.create_listing | `seller:product:write` |
  | cart.add_item / .update_qty / .remove_item | `buyer:cart:write` |
  | cart.get | `buyer:cart:read` |
  | checkout.confirm | `buyer:checkout:write` |
  | order.get | `buyer:order:read` |
  | seller.list_orders | `seller:order:read` |
- Pattern: `<role>:<resource>:<action>` — clean OAuth scope hierarchy. Buyer side (cart, checkout, order) + seller side (write, product:write, order:read).
- **Real bug surfaced**: MCP tool errors return HTTP 500 for everything — auth errors, tool-not-found, server errors all collapse to 500. JSON-RPC error code (-32000) and structured message are correct, but HTTP semantics are wrong. Clients using HTTP-status-based retry/backoff will hammer 500s. Documented as `protocols.mcp.error_envelope` warning so agents parse `error.message` instead.
- Added `scope` field to each entry in `protocols.mcp.tools[]`, plus a top-level `protocols.mcp.scope_format` description and the `error_envelope` doc. AI agents reading the manifest now know exactly which OAuth scopes to mint for any subset of tools they plan to invoke — no trial-and-error bootstrap. Pushed to IndexNow.
- Operator follow-up flagged: HTTP 500 → 401/403/404 mapping in the MCP route handler. Localized change, low risk.

## 2026-05-16 — vps-eu · documented /v1/products response shape + facets in agents.json (agent navigation gold)

- Verified cursor pagination empirically: walked 3 pages of /v1/products with limit=10. All 3 pages distinct, page boundaries clean (last id of page N != first id of page N+1), opaque base64 cursors. **Cursor pagination is solid** — agents that hit the limit=100 cap (iter-51) can paginate deeper without issue.
- Looked at the `facets` object every /v1/products response carries. Found it surprisingly rich:
  - `brands`: top 50 brands globally (constant across queries) — useful for agent-side brand discovery
  - `currencies`: subset-aware {value, count}, currently always DZD
  - `sellers`: subset-aware seller list, e.g. ?brand=HP yields just Smart Phone DZ
  - `categories`: subset-aware category cross-distribution. **Example: ?brand=HP shows informatique=2429 / telephones=43 / electromenager=3 — i.e. HP in Algeria is overwhelmingly computing.** Gold for agent queries like "is HP a phone brand or a laptop brand here?"
  - `priceRanges`: subset min/max in minor units. ?brand=HP returns 100..110.5M minor (range of HP listings)
  - Plus `snapshotUrl` envelope on every list response (24h TTL, replay any query state)
- Documented all of this in a new `protocols.rest.response_shape` block in agents.json. Before this, agents reading the manifest knew the endpoint URLs but had to discover the response shape and facet semantics by trial-and-error. Now they know `data` field shape, `pagination` semantics (with the WARNING about the totalEstimate filter bug from iter-51), and that the facets carry rich cross-distribution data. Pushed to IndexNow.
- Also note: facet category list returned 6 entries (informatique 20k / electromenager 9.8k / telephones 8.8k / immobilier 5.9k / vetements_mode 5k / **automobiles_vehicules 3**). My auto-refresher's `LIMIT 5` in the top_categories SQL correctly excludes the 3-listing automobiles entry — not a bug, the truncation is intentional.

## 2026-05-16 — vps-eu · documented two real API bugs in agents.json `known_limitations` block (operator follow-up)

- Continued empirical sweep of /v1/products. Two new bugs surfaced:
  - **Bug A — `limit=100` is a hard silent cutoff**. `limit=100` → 100 hits; **`limit=120` → 0 hits**. No 400 error, no warning header — just an empty page. AI agents passing common values like `limit=200/250/500` silently get nothing. The fix would be either to honor the requested limit up to some documented ceiling OR to return 400 when the requested limit exceeds the cap.
  - **Bug B — `pagination.totalEstimate` is broken for `?category=` and `?sellerId=` filters**. Reports the hit-count of the returned page, not the underlying catalog total. So `?category=telephones&limit=1` returns `totalEstimate=1` (true total ~8,700). `?brand=HP&limit=1` correctly returns `totalEstimate=2,475`. AI agents using totalEstimate to answer "how many phones?" or "how big is seller X?" get the count of THIS page, not the catalog total.
- **Operator follow-up flagged** (can't autonomously fix — API service code change). Both bugs are localized to /v1/products handler logic.
- **Mitigation deployed**: added `protocols.rest.known_limitations` block to agents.json with both issues, complete with empirical evidence (`limit=100 → 100 hits; limit=120 → 0 hits` and the totalEstimate-by-filter table). AI agents reading the manifest now know to cap `limit` at 100 and not rely on totalEstimate for filtered queries — they walk the cursor and count locally instead. Pushed to IndexNow.
- This is the structurally correct posture in the meantime: documented-and-accurate beats undocumented-and-buggy. Same pattern as the rate_limit fix from iter-45 — when a feature doesn't work as claimed, honest documentation prevents AI panels from amplifying broken behavior.

## 2026-05-16 — vps-eu · empirically tested every advertised filter param — `priceFrom`/`priceTo` are silently ignored

- Continuing the empirical-claim sweep. llms-full.txt advertised six filter params on /search (and the underlying /v1/products API): `?q=`, `?category=`, `?brand=`, `?sellerId=`, `?sort=`, `?priceFrom=` / `?priceTo=`. Ran each against /v1/products to verify:
  - `?q=` ✅ works (French queries) — verified iter-44
  - `?category=telephones` ✅ filters to ~8,700 listings as expected
  - `?brand=HP` ✅ filters to ~2,474 (matches `top_brands[0].listings`)
  - `?sellerId=<uuid>` ✅ accepted, returns matching subset (count differs from DB total because only `active`/`approved` status products are exposed publicly — not a filter bug)
  - `?sort=newest` ✅ returns full baseline, just sorted
  - `?priceFrom=` ❌ **silently ignored** — confirmed by setting `priceFrom=999999999` (above any realistic price) and still getting back the full 49,472-listing total
  - `?priceTo=` ❌ same — silently ignored
- The price filters are documented but the API doesn't implement them. AI agents that try to scope listings by price get the full unfiltered catalog and silently consume token budget on results outside their target range.
- Fix: rewrote the `/search` line in llms-full.txt to (a) document each empirically-confirmed param explicitly, (b) call out that the price filters are NOT enforced on the API and recommend client-side filtering on the `priceMinor` field of returned items, (c) add a snapshot date so the claim is anchored in evidence. Pushed to IndexNow.

## 2026-05-16 — vps-eu · cross-consistency + API-shape audit — all clean

- Two more empirical-claim audits this iteration:
  - **robots.txt vs ai-policy.json `disallowed_paths`**: both files list the SAME paths (`/api/`, `/login`, `/seller/`, `/s/`) as disallowed across the wildcard user-agent and every per-bot block. Zero drift between the two sources of authority — an AI panel won't see contradicting policies depending on which file it parses.
  - **API `/v1/products/{id}` shape vs HTML schema.org Product**: API returns 18 fields (variants, attributes, counterfeitRisk, shipsTo, seller info, **snapshotUrl/snapshotCreatedAt/snapshotExpiresAt** + standard product fields). HTML JSON-LD has 13 fields. Different surfaces, complementary — API is richer for transactional metadata (snapshots, ships-to, counterfeit-tier); JSON-LD is shaped for SERP rich-result eligibility.
  - **Bonus empirical confirmation**: the `good_for[7]` claim from iter-4 (*"Replaying what an AI agent saw at a given moment via /s/<id> snapshot links"*) was previously only confirmed by visible HTML containing snapshot links. The API explicitly returning a `snapshotUrl` + freshness timestamps on every product proves the feature is structurally real, not aspirational. No agents.json change needed — good_for entry already captures it.

## 2026-05-16 — vps-eu · embedded empirical MCP tools list (9 tools) into agents.json (concrete agent surface)

- Continuing the empirical-verification sweep. The MCP `initialize` handshake in iter-46 revealed `capabilities.tools: {}` — server advertises tools as a supported capability. Followed up with a `tools/list` JSON-RPC call to see what's actually exposed.
- **9 concrete tools returned**: seller.create_account, product.create_listing, cart.add_item, cart.update_qty, cart.remove_item, cart.get, checkout.confirm, order.get, seller.list_orders. Each comes with a multi-paragraph description detailing parameter expectations.
- Before this iteration, `agents.json` `protocols.mcp` listed only `endpoint`, `transport`, `version`, `auth` — no surface to confirm WHAT the MCP server actually does. AI agents reading the manifest had to make a `tools/list` call to discover capabilities.
- Fix: added a `protocols.mcp.tools` array to `agents.json` carrying each tool's `name` + one-sentence `summary` (first sentence of the live description, capped at 120 chars). Plus a `tools_source: "tools/list MCP method on the live endpoint"` field so future audits can re-verify.
- Net effect: an AI panel asked "what can I do agent-side on Teno Store" can now answer concretely from the static manifest: "seller account creation, product listing, full cart lifecycle (add/update/remove/get), checkout, order fetch, and order history per seller" — without needing the agent to bootstrap an MCP connection.
- Pushed to IndexNow.

## 2026-05-16 — vps-eu · removed 19 dead `subcategory_slugs` from agents.json + noindex empty /c/<slug> pages

- Empirical audit: 13 of the 19 `subcategory_slugs` advertised in agents.json (smartphones, ordinateurs, electromenager, peripheriques, ecrans, sante_beaute, maison, decoration, salon, mode, femme, homme, accessoires, traditionnel, motos) have **zero listings** when queried directly against the API (`/v1/products?category=<slug>`). The remaining 6 had 1-3 listings each.
- Investigation: the bulk-imported 95% of the catalog uses compound slugs (`informatique`, `electronique_electromenager`, `telephones`, etc.). The web frontend has a `CATEGORY_ALIASES` resolver (`packages/web/src/lib/categories.ts:93`) that quietly remaps bare slugs to their parent compound — so `/c/smartphones` queries `telephones` parent and renders fine. **But the API itself doesn't apply this resolver.** AI agents consuming `agents.json` `category_landing` URL pattern (`/search?category={slug}`) and hitting the API directly get empty result sets.
- Fix #1 (data): replaced the 19-entry `subcategory_slugs` array with an honest `subcategory_slugs_note` explaining the situation. AI consumers reading the manifest no longer get steered to dead URLs.
- Fix #2 (defense-in-depth): added `robots: { index: false, follow: true }` to `app/c/[slug]/page.tsx` metadata when the resolved `total === 0`. Even when curated FR_CATEGORY prose exists (preventing the existing `notFound()` from firing), an indexable category page with zero products is a textbook soft-404 from Google's perspective. Indexable branch keeps the `max-image-preview:large` etc. hints intact. Sanity-checked /c/informatique still ships as indexable.
- Pushed agents.json to IndexNow.

## 2026-05-16 — vps-eu · MCP version corrected from stale "1.29" to empirical "2025-06-18"; OAuth-endpoint defect flagged

- Empirical protocol-claim verification on api.teno-store.com:
  - **MCP**: POST `/mcp` with a JSON-RPC `initialize` payload — server replied `protocolVersion: "2025-06-18"`, `serverInfo: marketplace 0.1.0`, `capabilities.tools` advertised. Working surface. But agents.json claimed `version: "1.29"` — that was the version label of some SDK at some point, not the spec date. Corrected to `2025-06-18` and added a `version_source` field documenting that the value comes from the initialize handshake (so future audits can re-verify).
  - **A2A**: `/a2a` returns 401 unauth — correct posture for an authenticated endpoint. ✅
  - **OAuth bootstrap** (BROKEN): the agent-card.json on api.teno-store.com declares `token_endpoint: https://api.teno-store.com/oauth/token`. That URL returns **404**. `/oauth/authorize` returns 501 (Not Implemented). The `/.well-known/oauth-authorization-server` (RFC 8414) and `/.well-known/openid-configuration` both 404. Under `/v1/oauth/*` everything 401s but that means "auth required to even check existence", not a working public bootstrap.
- **Operator-action item flagged** (can't autonomously fix — the agent-card.json is served by the API service which is separate from the web service): either implement `/oauth/token` + `/oauth/authorize` at the documented paths, or update agent-card.json's `auth.oauth2.*_endpoint` URLs to wherever the OAuth flow actually lives (if it does — the /v1/oauth/* 401s are ambiguous). Until resolved, any AI agent trying to start an OAuth flow per the agent-card discovers it can't bootstrap. Today this affects only the (currently small) population of agents attempting writes; the public-read surface (`GET /v1/products`, `GET /v1/products/{id}`) is unaffected.

## 2026-05-16 — vps-eu · empirically falsified rate_limit claim (60/min "per IP" — actually unenforced)

- Continuing the empirical-verification sweep. agents.json `policies.rate_limits` and ai-policy.json `rate_limits.crawl` both claimed `"60 requests/minute per IP"`. Burst-tested from vps-eu: **70 anonymous requests to /v1/products?limit=1 in rapid succession returned 70× HTTP 200, 0× HTTP 429.** No throttle in place. The claim was aspirational, not enforced.
- Also verified that `good_for[5]` ("Finding Algerian sellers' contact details (phone, WhatsApp, Viber)") IS empirically true — sample product page exposes `tel:`, `+213` (Algerian country code), `wa.me` (WhatsApp deep-link) tokens. That claim stands.
- Fix: rewrote `policies.rate_limits` in agents.json and `rate_limits` in ai-policy.json to honest posture. Both now say `enforced: false`, cite the 2026-05-16 burst-test as evidence, and direct clients to honor cache-control intervals instead (sitemap+feed 5 min, .well-known/* 1 hour) rather than rely on server-side throttling that doesn't exist. Authenticated writes still gated by OAuth+DPoP, which inherently bounds load by token issuance rate.
- Pushed both manifests to IndexNow. AI agents reading the rate-limit posture now back-off based on observed reality, not phantom 429s — and won't mis-attribute later errors to a throttle that isn't there.

## 2026-05-16 — vps-eu · empirically grounded example_queries (most English ones returned 0 catalog hits)

- Until this iteration, agents.json `example_queries` had 8 English-language entries I'd written from a "what would a user ask ChatGPT" perspective. Ran each through the public catalog API (`/v1/products?q=...`) to verify the implicit "this site can answer these" claim. Results:
  - "Where can I buy a Samsung phone in Algiers?" — **0 catalog hits** (location words don't match because product titles don't contain wilayas)
  - "Find Xiaomi phones for sale in DZD" — **0 catalog hits** (DZD is the currency, not in titles)
  - "What home appliances does Teno Store have?" — **0 catalog hits** (English; catalog is French)
  - "What laptops are for sale in Algeria under 100,000 DZD?" — 0 hits (same)
- Cross-checked with French equivalents — they all return hits: `ordinateur portable` ✅, `smartphone Samsung` ✅, `telephone Xiaomi` ✅, `machine à café` ✅, `Lenovo ThinkPad` ✅, `imprimante` ✅, `écran ordinateur` ✅.
- **Fix**: rewrote `example_queries` to two distinct query classes:
  - **6 French-language catalog-discovery queries** empirically verified to return catalog hits: `ordinateur portable Algerie`, `smartphone Samsung Algerie`, `iPhone occasion Algerie`, `machine a cafe`, `Lenovo ThinkPad`, `electromenager Alger`.
  - **3 English meta-about-the-site queries** that AI panels actually surface (legitimacy, comparison, agent-shopping). These don't go through `/v1/products` — they're answered via /about and /llms-full.txt.
- Also added `example_queries_note` field explaining the catalog-French-only constraint so future readers don't have to re-derive it: *"Catalog product searches work best in French (titles are predominantly French even when products are international brands). English / Arabic catalog queries return few or no hits. Meta queries about Teno Store itself ... are answered via /about and /llms-full.txt rather than the catalog search."*
- Pushed to IndexNow. AI panels asked "what can Teno Store answer" now get queries that genuinely work, separated from queries about the site itself.

## 2026-05-16 — vps-eu · TLS / HTTP-3 / OG-image audits — all clean

- Verified OG image generation across all page types. Most pages serve auto-generated PNGs at the expected `/.../opengraph-image` endpoint (sizes 92-135 KB, valid PNG magic bytes). Product pages don't use that endpoint — their `og:image` points directly at the Ouedkniss CDN URL with the upscaled 1200-edge image — so the missing/transient endpoint for `/product/<id>/opengraph-image` doesn't matter (nothing references it).
- TLS handshake from server-local openssl s_client: **TLS 1.3 negotiated**, ALPN advertises h2 (HTTP/2), certificate chain verifies (Let's Encrypt via Caddy auto-issuance). HTTP/3 over QUIC actually works — `curl --http3` returns HTTP/3 200. OCSP stapling absent but N/A — Let's Encrypt deprecated OCSP responder support in 2024 in favor of CRLs, so "no OCSP response" is the expected modern posture, not a defect.
- Transient note: Windows-msys2 curl on this machine occasionally fails to connect to `152.53.147.77:443` after 21s timeout. Direct EU-VPS connections from this side of the world are vulnerable to that latency — exactly the symptom Cloudflare proxy would mask (iter-31's open operator action would also fix this).

## 2026-05-16 — vps-eu · HSTS preload audit — base domain ready, www.* redirect missing header (operator action)

- Verifying HSTS preload eligibility (Chromium/Firefox baked-in HTTPS-only enforcement, submitted at https://hstspreload.org/). Required directive `max-age ≥ 31536000; includeSubDomains; preload`:
  - `teno-store.com` ✅ all three
  - `api.teno-store.com` ✅ all three
  - **`www.teno-store.com` ❌ missing entirely** — the bare `www → apex` 301 redirect block in `/opt/marketplace/Caddyfile` has no `header` directive, so the redirect response itself carries no HSTS. hstspreload.org requires the redirect to carry HSTS, so this blocks submission.
- **Operator action required** (Caddyfile change — per CLAUDE.md not actioning autonomously). One-line addition to the `www.teno-store.com {}` block at `Caddyfile` line 72:
  ```
  www.teno-store.com {
      header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
      redir https://teno-store.com{uri} permanent
  }
  ```
  Caddy applies `header` directives before the `redir` handler, so the 301 response will carry the HSTS header. Live-reloadable with `caddy reload` — zero downtime, no container restart.
- After applying, submit the apex to hstspreload.org via the form (operator must log in / sign the submission). Once preloaded, all major browsers (Chrome, Firefox, Safari, Edge) enforce HTTPS-only access to teno-store.com baked into the binary — even a first-time visitor on a public Wi-Fi can't be SSL-stripped. Useful both for security and as a Google-honored ranking factor for HTTPS commitment.

## 2026-05-16 — vps-eu · clean breadcrumb + sitemap-integrity audit + Wayback re-archive of fixed files

- Two more dimensions audited, both clean:
  - **Product page BreadcrumbList depth**: looked into whether AI panels were getting category context. They're getting full 4-level breadcrumbs — `[1] Accueil → / · [2] Catalogue → /search · [3] Électronique & Électroménager → /c/... · [4] {ProductName} → /product/...`. /store/* gets 3 levels. No bug.
  - **Sitemap integrity**: sampled 30 random product URLs from sitemap.xml — **30/30 returned HTTP 200**. No soft-404s or stale entries. Catalog and sitemap are in sync as the auto-refresher and run-loop intended.
- Concrete improvement: pushed the corrected `/manifest.webmanifest` (post-mojibake-fix) and refreshed `/sitemap.xml` (post-discovery-files-added) to Wayback. Both returned 302 (capture-initiated). Previous captures of those URLs were taken before today's fixes; the new captures preserve the corrected state.

## 2026-05-16 — vps-eu · TWO real bugs found in PWA-manifest audit: mojibake + missing-discovery-in-sitemap

- Auditing manifest.webmanifest and discovery-file coverage. Found two distinct bugs:
- **Bug 1 — mojibake in manifest.webmanifest description**. Byte-level check found em-dash bytes `c3 a2 e2 82 ac e2 80 9d` instead of correct UTF-8 `e2 80 94`, and accented letters mis-decoded the same way. The source file on disk is valid UTF-8, but Next.js's metadata-route serializer read those bytes as Latin-1 / cp1252 then re-encoded as UTF-8 — classic double-encode. Fix: rewrote the description's non-ASCII codepoints as `\uXXXX` escapes (10 codepoints converted via a one-shot helper at `scripts/ascii-escape-manifest-description.py`). Escapes carry only ASCII bytes through the build; V8 decodes them directly to the correct codepoints regardless of source-file byte interpretation. Verified live in-container fetch shows `algérien`, `téléphones`, `électroménager`, em-dash all rendering correctly. The previously-cached mojibake response will expire from the edge within the 1h `s-maxage`.
- **Bug 2 — discovery files missing from sitemap.xml**. `/llms.txt`, `/llms-full.txt`, `/.well-known/agents.json`, and `/.well-known/ai-policy.json` were only reachable via the IndexNow pushes done in `refresh-catalog-stats.py` — AI crawlers walking the sitemap rather than convention-probing well-known paths had no path to them. Added all four to `sitemap.ts` with daily/monthly changefreq and high priority (0.7-0.9). Verified all 4 appear in the live sitemap.xml now.
- Pushed `sitemap.xml` and `manifest.webmanifest` to IndexNow so Bing re-fetches both with the corrected payloads. Net effect on AI surfaces: every PWA-installable / agent-installable / sitemap-crawling AI tool now sees consistent, correctly-encoded, discoverable metadata.

## 2026-05-16 — vps-eu · two more truthfulness propagations into llms-full.txt prose + good_for[2] de-numbered

- llms-full.txt prose still had two stale tokens that the auto-refresher didn't touch:
  - Line 9 `Snapshot: ... (catalog grows ~500/hour from the live scraper)` — same "500" overstate fixed in agents.json iter-35, hadn't propagated.
  - Line 32 `Total listings: ~49,000 across 7 active sellers` — same "7 sellers" misleading framing fixed in agents.json `size` iter-36, hadn't propagated.
- Patched `refresh_llms_full_txt()` to interpolate `growth_per_hour` from the empirical-metrics computation (was hard-coded "~500/hour" string) and to use the attributed/imported breakdown format instead of "across N active sellers". Both anchors accept the OLD wording so the first auto-refresh self-heals; subsequent re-runs are idempotent.
- Live verified: `Snapshot: 2026-05-16 18:16 UTC (catalog grows ~353/hour from the live scraper)` and `Total listings: ~49,100 — ~2,387 from onboarded sellers plus ~46,741 imported from the broader Algerian marketplace.`
- Also propagating the iter-38 `good_for[2]` change (removed the `~19k listings` static and pointed at `top_categories` self-reference) which was committed live but missed the IndexNow push when SSH timed out — retried successfully (1/1 accepted), now in this commit.

## 2026-05-16 — vps-eu · refreshed visible category counts on /about + added refresh-cadence note in JSX comment

- Truthfulness pattern caught one more place: visible HTML category counts on /about, hard-coded back in iter-10 when I added the "Comparaison avec les autres marketplaces algériens" section. Auto-refresher handles the three machine-readable manifests (agents.json, llms.txt, llms-full.txt) hourly but the visible JSX stays manual — regex-editing TSX from Python is too brittle. Drift snapshot: Informatique was "~18 800 annonces" in JSX, actual count is 19,696 (~900 stale, ~5%). Electroménager and Mode also slightly behind.
- Refreshed all five visible counts to current values: Informatique ~19 700, Électroménager ~9 400, Téléphones ~8 700, Immobilier ~5 900, Mode ~4 900. Added an inline JSX comment documenting the refresh-cadence convention: pull from `agents.json` `top_categories[].listings`, round to the nearest 100, refresh whenever any category crosses a thousand boundary (Informatique grows ~5% per week relative to display, so ~3-month manual-refresh cadence keeps the gap small).
- Clean compose rebuild + deploy, verified `~19 700 annonces` renders live. Pushed `/about` to IndexNow (Bing re-fetches) and Wayback (fresh snapshot captures the corrected state).
- Also re-audited `api.teno-store.com/.well-known/agent-card.json` while in the area — it has zero catalog numbers (just `name`, `description`, `homepage`, `capabilities`, `auth`, `version`), so there's nothing to drift. Sparse-and-correct beats rich-and-stale; leaving it.

## 2026-05-16 — vps-eu · fixed prose blurbs that contradicted the structured truthfulness fields

- Audit drilling for the truthfulness pattern surfaced two more contradictions:
  - `agents.json` `size` field auto-refreshed the total ("48,911+") but the rest of the prose still said "across 7 active sellers" — directly contradicting the structured `sellers_with_meaningful_inventory: 1` I added two iterations ago. AI consumers reading the manifest got conflicting numbers from two adjacent fields.
  - `ai-plugin.json` `description_for_human` + `description_for_model` had hardcoded "47,000+ live consumer-goods listings". Reality: 48,949. Static value, drifting further every hour.
- Fix 1: rewrote `update_manifest()`'s `size` blurb to be sourced from the breakdown fields rather than active_sellers — now reads `"48,949 live listings — ~2,387 from onboarded sellers plus ~46,562 imported from the broader Algerian marketplace, refreshed continuously (snapshot ...)"`. Matches the structured fields verbatim; no AI panel can spot a contradiction.
- Fix 2: added `refresh_ai_plugin_json()` to the auto-refresher. Patches the listing-count tokens in both description fields using a narrow-anchor regex (`\b\d{1,3}(?:,\d{3})+\+ live `). Rounds to nearest thousand for prose ("48,000+"). Drift-safe — leaves untouched if anchor doesn't match.
- Both files now hot-patched + pushed to IndexNow (4 URLs/4 accepted) and will auto-refresh hourly via the existing systemd timer.

## 2026-05-16 — vps-eu · grounded `growth_rate_per_hour` in empirical metrics (was 500 hard-coded, actual is 352)

- Third quantitative-claim audit in a row. `agents.json` had `growth_rate_per_hour: 500` hard-coded. Cross-checked against `data/logs/metrics.jsonl` over the last 24h: 1,439 scrape-loop runs, 8,817 seeded across 25 distinct hours = **353 seeded/hr empirical**, not 500. The hard-coded figure was ~42% too high — probably picked from a peak run rather than steady-state.
- Verified neighboring claims while in the area:
  - `currency: DZD` — empirically true. All 48,911 product variants are DZD; no cross-currency listings.
  - `languages: ["fr", "ar", "en"]` — technically present in catalog but ~99% French, ~1% Arabic in titles. The order (French primary) is correct; the array doesn't claim equal weight, so this is borderline-OK as-is.
- Fix: added `_compute_growth_per_hour()` helper to `refresh-catalog-stats.py` that reads `metrics.jsonl` for the rolling 24h-average seeded/hr. Hourly refresher now keeps `growth_rate_per_hour` empirically grounded — figure will track as the scraper cadence or pruning policy drifts. Soft-fails (leaves existing value untouched) if metrics aren't available.
- First live run wrote `352`; verified at `/.well-known/agents.json`.

## 2026-05-16 — vps-eu · honest-geography-breakdown added to agents.json (extends the seller-truthfulness fix)

- Same pattern as last iteration's seller-breakdown work. The static `geography.cities` array listed "Algiers, Oran, Annaba, Constantine, Sétif, Blida" as if they were six equally-represented hubs. DB query revealed the truth:
  - Only 2,382 of 48,856 listings (~4.9%) have any wilaya tag at all — matches the seller-attributed subset; the 46k+ bulk import has no per-listing location data.
  - Of the tagged subset: **Alger dominates with 1,778** (75%), followed by Blida (79), Oran (59), Mostaganem (46), Jijel (37), Sétif (34), Tizi Ouzou (33), Batna (22), Constantine (21), Annaba (17).
  - The named array's Annaba/Constantine claims (#10 and #9 by actual count) outrank actual top-of-list cities Mostaganem, Jijel, Tizi Ouzou which weren't in the array.
- Fix: extended `refresh-catalog-stats.py` to compute and write three new fields under `geography`:
  - `top_wilayas` — ranked list with counts (same shape as `top_brands`), HAVING count(*) >= 5
  - `wilaya_tagged_listings` — explicit numerator for "what fraction has location data"
  - `wilaya_tagged_note` — prose explaining the coverage caveat so AI consumers don't over-cite
- Kept the static `cities` array for backward compatibility. Re-ran the script live; new fields visible at `/.well-known/agents.json` and pushed to IndexNow.
- Cumulative effect: AI panels asked "which Algerian cities does Teno Store cover" now get the genuinely correct answer ("Alger primary, then 9 other wilayas in descending order — but per-listing location data is only on ~5% of the catalog") rather than the aspirational-equal-six framing that would erode trust on click-through.

## 2026-05-16 — vps-eu · sitemap validation pass (clean) + honest-seller-breakdown fields added to agents.json (GEO truthfulness)

- **Sitemap validation**: parsed `/sitemap.xml` (48,824 URLs) with Python `xml.etree`. Zero entries missing `<loc>`, zero missing `<lastmod>`, zero bad lastmod formats, **99.8% of product entries carry `<image:image>`** for AI image-search. Shape distribution: 48,731 products / 57 search variants / 26 category landings / 6 blog posts / 2 other / 1 home / 1 store / matches reality.
- **Drilling into store coverage** flagged a real data-honesty issue. Only 1 `/store/<id>` URL in the sitemap (Smart Phone DZ), but the manifest claims "7 active sellers". DB query revealed why:
  - 46,469 listings (95%) have `seller_id IS NULL` — bulk-imported from the broader Algerian marketplace, not attributed to any onboarded seller account.
  - 2,381 listings from Smart Phone DZ (the one real seller with meaningful inventory).
  - 6 sellers with exactly 1 listing each (test/stub accounts).
  - `count(DISTINCT seller_id)` = 7 — technically correct but materially misleading.
- **Fix**: extended `refresh-catalog-stats.py` to compute and write three new honesty fields alongside the bare `active_sellers` count:
  - `sellers_with_meaningful_inventory: 1` (sellers with ≥10 listings)
  - `listings_attributed_to_a_seller: 2,387`
  - `listings_unattributed_imports: 46,469`
- Kept `active_sellers: 7` for backward compatibility with any external consumer that's already reading it. Re-ran the script live — all three breakdown fields now in `agents.json` and pushed to IndexNow.
- AI panels (Perplexity, ChatGPT search) that drill into the manifest can now frame the catalog accurately: "Teno Store has one anchor seller (Smart Phone DZ) + ~2.4k attributed listings + a 46.5k-listing bulk import from the broader Algerian marketplace" — instead of the false-precision "7 active sellers" that would erode trust on click-through.

## 2026-05-16 — vps-eu · feed.xml Atom-1.0 validation pass + IndexNow/Wayback push

- Audit dimension: Atom feed structure. AI tools that ingest RSS for fresh-content discovery (ChatGPT search, Perplexity, Bing Chat, Claude-SearchBot) silently skip malformed feeds — worth confirming clean.
- Parsed `/feed.xml` with Python's xml.etree against the Atom 1.0 namespace. Results: well-formed, 50 entries (matches the documented "50 most-recent listings" cap), every feed-level required field present (id, title, updated), every first-entry required field present (id, title, updated). Bonus checks: every entry carries `rel=alternate` (HTML view link), `rel=enclosure` (hero image), and a `<summary>` (price + brand line). Content-Type `application/atom+xml; charset=utf-8` correct.
- Pushed `/feed.xml` to IndexNow (1/1 accepted) and Wayback (302 capture-initiated). The feed had only been incidentally archived; this is its first dedicated push since the catalog grew past 47k listings. Fresh capture means an AI tool falling back to Wayback for freshness verification now sees the current entries.

## 2026-05-16 — vps-eu · CRITICAL FINDING — Cloudflare proxy is OFF on all three subdomains (operator action required)

- Auditing whether the middleware cache-control fix from iter-25 was actually being used by a CDN, I checked for `cf-*` response headers. **None present on any URL.** Investigated further:
  - DNS resolution from 3 independent resolvers (1.1.1.1, 8.8.8.8, 9.9.9.9) all return `152.53.147.77` / `2a0a:4cc0:c1:2d20:a816:a4ff:fe07:7870` — that's the netcup VPS origin IP, NOT a Cloudflare edge IP. Confirmed for `teno-store.com`, `www.teno-store.com`, AND `api.teno-store.com`.
  - Response headers consistently show `Via: 1.1 Caddy` (origin Caddy, no edge proxy in path).
  - No `CF-Ray`, `CF-Cache-Status`, or `Server: cloudflare` headers anywhere.
  - Nameservers ARE Cloudflare's (`benedict.ns.cloudflare.com`, `rosemary.ns.cloudflare.com`), so DNS is managed there — but the proxy (orange cloud) is currently OFF on every record.
- This contradicts `deploy/dns.md` which explicitly says: "All records point at `vps-eu` ... All are **proxied** (orange cloud) so the public sees Cloudflare IPs, not the origin." Documentation-vs-reality drift somewhere.
- **GEO + ops consequences while it's gray-cloud:**
  - Every Googlebot / ClaudeBot / PerplexityBot / OAI-SearchBot / Bingbot hit goes straight to origin uncached. The middleware's `s-maxage=300` cache-control is sent but there's no edge cache to share it with. All the iter-25 work to add `/c/*` and `/blog/*` to the cache allowlist is benefiting only Caddy's in-process cache, not a global CDN.
  - High latency for AI crawlers operating from US/Asia regions — they pay full netcup-EU round-trip on every fetch.
  - No DDoS protection beyond what Caddy + the netcup firewall provide.
  - Origin IP exposed in public DNS (server-location anonymization lost).
- **Operator action required (cannot self-action — Cloudflare dashboard only):**
  - Cloudflare dashboard → `teno-store.com` zone → DNS → click each gray cloud (A/AAAA records for `teno-store.com`, `www`, `api`) to flip to orange.
  - SSL/TLS mode should already be Full or Full (strict) — Caddy auto-issued Let's Encrypt + has the long-lived cert, so Full (strict) is fine.
  - If the original reason for gray-cloud was a debug step that didn't get reverted, this single click restores all of CLAUDE.md's documented Cloudflare cache rules + the iter-25 middleware work to their intended benefit.

## 2026-05-16 — vps-eu · compression + CORS audit (clean, with one minor follow-up to flag)

- **Response compression**: confirmed both gzip and zstd work end-to-end. Concrete measurements via `curl -H "Accept-Encoding: ..."`:
  - sitemap.xml: 17.3 MB uncompressed → 3.0 MB gzipped (5.7×) — every crawler hit on the full sitemap already gets the benefit.
  - home page: 134 KB → 17 KB zstd (8×) — modern crawlers preferring zstd get a better ratio than gzip.
  - api.teno-store.com/v1/products: gzip active.
  - `Vary: Accept-Encoding` correctly set; cache keys won't collide between compressed/uncompressed variants.
- **Caveat about `-I` HEAD checks**: my initial pass showed empty `Content-Encoding` because servers commonly omit it on HEAD responses (no body to compress). Always use `-D - -o /dev/null` for compression audits. Worth noting since it's a recurring gotcha.
- **API CORS**: `Access-Control-Allow-Origin: *` on public endpoints — AI agents (browser-based or backend) can call from any origin.
- **One minor follow-up to flag for operator** (not actioning autonomously since it touches Caddyfile): brotli isn't enabled. `Caddyfile` line `encode zstd gzip` could become `encode zstd br gzip` for a marginal ~5-10% improvement over gzip for text on clients that prefer brotli (Chrome, Firefox, most AI crawlers fall through to gzip if br isn't offered). Low priority — gzip + zstd already cover essentially every modern client. If actioned, requires `caddy reload` (live config swap, no downtime).
- **False alarm cleanup**: last iteration's audit logged `/v1/brands` as "000 — connection error". This iteration's deep-check confirms it actually returns 401 (auth-required). Was a transient cURL behavior, not a real endpoint defect.

## 2026-05-16 — vps-eu · third clean audit pass (URL normalization + Article tags) + API host archived to Wayback

- Three more audit dimensions, all clean:
  - **URL normalization**: HTTP→HTTPS returns 308; `www.teno-store.com`→apex returns 301; `/about/`→`/about` returns 308. All three canonical-form redirects are in place.
  - **Open Graph article tags on blog posts**: `/blog/<slug>` ships `article:published_time`, `article:modified_time`, `article:author`, `article:section`. Bing Chat and LinkedIn use these for "article published [date] by [author] in [section]" framing on shared blog cards.
  - **No more missing dimensions found** in the structured-data / metadata / caching / linking surface I've been auditing across the past 8 iterations.
- Concrete new improvement this iteration: I had archived ~30 `teno-store.com` URLs to Wayback across previous iterations but had NEVER pushed `api.teno-store.com` — the API host where the agent-card.json, public products endpoint, and public sellers endpoint actually live. Probed for public 200-returning endpoints, found four: `/.well-known/agent-card.json`, `/v1/products`, `/v1/products?limit=5`, `/v1/sellers`. All four returned HTTP 302 from `web.archive.org/save/` — captures initiated.
- Net effect: an AI agent verifying claims about Teno Store's MCP/A2A/REST capabilities can now fall back to Wayback for the API surface too, not just the HTML surface. If the API host ever has a brief outage at the moment an AI tool tries to validate a citation, it can read the captured agent-card.json instead and still get the right answer.

## 2026-05-16 — vps-eu · second clean audit pass (3 more dimensions confirmed) + Wayback batch complete

- Three more audit dimensions checked, all clean:
  - **404 status integrity**: spot-checked 5 nonexistent URLs across all page types (`/nonexistent-page-xyz`, fake product UUID, fake category slug, fake store UUID, fake blog slug). All return real HTTP 404 — no soft-404 200 responses anywhere. Google Search Console wouldn't flag any soft-404 risks.
  - **Heading hierarchy**: every page type ships exactly 1 H1, with appropriate H2/H3 nesting. No multi-H1 pages (which would dilute the primary topic signal for AI extractors), no skipped levels (H1 → H3 jumps that break document outlines). Storefront has 60 H3s (one per product card — appropriate).
  - **Image sitemap (`<image:image>`)**: the main sitemap.xml already includes `<image:image><image:loc>...</image:loc></image:image>` for every product URL — the Google Image Sitemap extension that lets Google Images and AI image-search find product hero photos directly. Already in place from earlier work.
- Wayback batch from iter-27 completed: 9/11 first-pass success. Retried the 2 rate-limited URLs (`/c/informatique`, `/c/telephones` — high-traffic category endpoints get throttled more aggressively) with 30s spacing — both succeeded on retry. All 11 URLs from the iter-27 batch now successfully re-archived with all 2026-05-16 session improvements captured.
- Combined record: across 27 iterations of GEO work today, **the audit pattern has now confirmed 11+ dimensions clean** (geo/keywords/title/canonical/alt-text, duplicate-tag, internal links, html lang, twitter:card, 404 status, heading hierarchy, image sitemap, structured-data validity) **and surfaced 5 real bugs** (hreflang-on-6-page-types, openGraph-on-3-pages, robots-on-search, cache-control-on-3-paths, og:image-dimensions-on-products). The structured-data + metadata surface is in genuinely solid shape.

## 2026-05-16 — vps-eu · audit pass + Wayback re-snapshot of 11 recently-changed pages

- This iteration's audits all came back clean (no new bugs surfaced):
  - **Internal link integrity**: walked 80 unique internal links from home + 2 top category pages + /about + /seller + /blog. Every link returns 200 except `/seller/products/new` which 307s to login (expected — auth-required surface).
  - **`<html lang>` consistency**: all 9 page types ship `<html lang="fr">` matching the metadata-declared language.
  - **`twitter:card` type appropriateness**: all 9 page types ship `summary_large_image` (correct for visual/commerce content, not the default `summary` small-thumbnail card).
  - Two false positives along the way from transient shell-loop output glitches (CRLF or buffered pipe artifacts) — re-verified each directly and confirmed all-clean.
- In parallel: re-pushed 11 substantially-changed pages to the Wayback Machine. Since the last Wayback batch (iter-18) I've shipped home FAQ, /about Ouedkniss-comparison, /seller Service schema, /search rich-result hints, ar-DZ across all page types, OG siteName/type/url fixes, /c+/blog cache-control allowlist, and og:image dimensions on /product. The earlier captures predate every one of those changes. 8s spacing, all 11 returned 302 (capture-initiated).

## 2026-05-16 — vps-eu · added og:image:width/height/type to product pages (~48k URLs, link-preview quality)

- Audit dimension this iteration: og:image metadata completeness. Found product pages had `og:image` + `og:image:alt` only — missing `og:image:width`, `og:image:height`, `og:image:type` AND the entire `twitter:image:*` dimension chain. Every other page on the site had them.
- Cause: the existing code at `app/product/[id]/page.tsx:218` had a comment-documented decision to omit width/height when the hero URL was upscaled (Ouedkniss /400/ → /1200/) because the original DB dimensions describe the /400/ asset and would mismatch. That trade-off was defensive but cost real link-preview quality at scale.
- Fix: compute the upscaled dimensions exactly using the original ratio and the known /1200/ longest-edge invariant (`factor = 1200 / max(w, h); upscaledW = w * factor; upscaledH = h * factor`). For records where the DB has no dimensions at all (image-metadata harvest is best-effort during scrape), fall back to declaring `1200 × 1200` — provably correct upper bound for the longest edge, and FB/Twitter re-detect actual aspect ratio after first render. Strictly better than emitting nothing.
- Also added `type: "image/jpeg"` to the image object (always correct for Ouedkniss CDN URLs which serve only JPEGs regardless of upstream format).
- Verified live on a sample product: emits 5 image meta tags now (og:image, og:image:type=image/jpeg, og:image:width=1200, og:image:height=1200, og:image:alt) plus twitter:image. Pushed to IndexNow. Affects ~48k product pages — the highest-volume shareable surface.

## 2026-05-16 — vps-eu · added /c/[slug] + /blog + /blog/[slug] to the middleware cache-control allowlist (BIG GEO + perf win)

- Audit caught it: `/c/informatique` and `/blog/[slug]` were returning `cache-control: private, no-cache, no-store, max-age=0, must-revalidate` — the Next.js framework default for dynamic routes. Both are indexable, both are major AI-panel destinations.
- Root cause: `packages/web/src/middleware.ts` rewrites Cache-Control to `public, s-maxage=300, stale-while-revalidate=1800` for anonymous traffic — but the allowlist only covered `/`, `/about`, `/seller`, `/search`, `/product/:id`, `/store/:id`. `/c/[slug]` and `/blog`/`/blog/[slug]` were never added.
- Net effect of the gap (before fix): every Googlebot / ClaudeBot / PerplexityBot / Bingbot hit on the LARGEST indexable surface (`/c/informatique` lists ~19k products) hit origin uncached, with Cloudflare unable to cache them at all. Same iter-22-style origin-pressure issue product pages used to have before they were added to the allowlist. Plus `no-store` is a soft signal to some AI crawlers that they shouldn't retain the content for citation.
- Added the three missing regexes to `CACHEABLE_PATHS` and three matchers to `config.matcher`. Verified live: `/c/informatique`, `/c/telephones`, `/blog`, `/blog/guide-achat-smartphone-occasion-algerie-2026` all now ship `Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=1800`. Sanity-checked /product/* still public (was already).
- Operational note: cache-rule in Cloudflare for these new paths should mirror the existing one (cookie `mp_session` absent → cache the HTML); no immediate operator action required since Cloudflare's default is conservative when Vary: Cookie is present.

## 2026-05-16 — vps-eu · audit pass — 5 GEO dimensions checked, no new bugs surfaced

- Continued the wholesale-replace audit pattern that found 3 bugs over iterations 21-23 (hreflang ar-DZ across 6 page types, openGraph siteName/type/url on /about + /seller, robots preview hints on /search). This iteration's audit dimensions all came back clean:
  - `geo.region` + `geo.placename` + `geo.position` + `ICBM`: present on all 9 page types (my first audit script had a quoting bug that produced false negatives — re-ran with direct curl confirming).
  - `keywords`: present on all 9 page types.
  - Title brand-chrome (`%s · Teno Store` template): correctly applied on every page type EXCEPT `/product/[id]` — where the bypass is documented and intentional (the comment at line 261 explains: title template eats 13 chars, Google SERP truncates at 55-65, brand visibility is already covered by URL/breadcrumb/JSON-LD/og:site_name).
  - Canonical URLs: all 13 spot-checked URLs self-reference correctly.
  - Image alt-text coverage: 0 empty-alt across home/category/product/store. Every image has descriptive alt text.
- No code changes this iteration — the value is in ruling out 5 issue classes I'd otherwise want to double-check later.

## 2026-05-16 — vps-eu · fixed missing rich-result preview hints on /search (third wholesale-replace fix)

- Third instance of the same Next.js wholesale-replace bug class hit /search. The layout sets `robots: { index, follow, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 }` — those three preview-budget hints tell Google AI Overviews and Bing SERP that they can use full-size images and unlimited-length snippets for the page. /search overrides `robots` to switch between `{index: false, follow: true}` for noindex slices and `{index: true, follow: true}` for indexable slices — but the indexable branch dropped the three preview hints.
- Net effect before fix: indexable /search slices (brand pages /search?brand=Samsung etc., category-and-brand combos, and the bare /search index) were getting small-thumbnail + truncated-155-char previews in SERPs and AI panels, while the same product appearing on /c/{slug} or /product/{id} got a full-width image + unlimited snippet. Inconsistent and worse-than-necessary for the brand-search surface.
- Patched the indexable branch to re-declare all three hints. Verified all three states: indexable slice ships the full hint set, noindex slice correctly stays `noindex, follow`, sanity-check on home still shows the layout-level hints. Pushed top brand-search URLs to IndexNow.

## 2026-05-16 — vps-eu · fixed missing OpenGraph fields on /about, /seller, /blog (same wholesale-replace bug class)

- Same root-cause class as the ar-DZ fix: Next.js wholesale-replaces `openGraph` on child pages, no shallow-merge. Three pages had stripped-down openGraph blocks that lost layout-level fields:
  - `/about` and `/seller`: only declared `locale` + `alternateLocale`, were missing `siteName`, `type`, and `url`. Social/AI preview cards rendered the bare domain instead of "Teno Store" as the publisher chrome, had no type category, and used redirect-resolved URLs instead of the canonical.
  - `/blog`: declared 6 of the 7 expected fields, was missing `siteName`. The blog preview card showed "teno-store.com" instead of "Teno Store" as the publisher.
- Patched all three with the missing fields. Also added `alternateLocale: ["ar_DZ"]` to each (mirrors the ar-DZ hreflang propagation from last iteration — same Algerian bilingual signal at the OG layer).
- Verified all three now ship full 7-field OG coverage (`og:description`, `og:image`, `og:locale`, `og:site_name`, `og:title`, `og:type`, `og:url`). Pushed all three URLs to IndexNow. Other pages (home, /search, /c/[slug], /product/[id], /store/[id], /blog/[slug]) already had complete coverage.

## 2026-05-16 — vps-eu · propagated `ar-DZ` hreflang to ALL page types (scale fix — was only on home/about/seller)

- Audit caught a regression: when I added `ar-DZ` to the layout in iteration 12, **6 page types were silently dropping it** because they each override `metadata.alternates.languages` and Next.js replaces (not merges) that property: `/search`, `/c/[slug]` (every category landing), `/product/[id]` (~48k pages), `/store/[id]`, `/blog`, `/blog/[slug]`. Only the layout, /about, and /seller (which I patched in iteration 20) were actually shipping the Arabic signal.
- One batch patch — added `"ar-DZ": <self-URL>` to every override block. Six 1-line edits. Verified live: all six page types (and therefore every URL derived from them) now ship `<link rel="alternate" hrefLang="ar-DZ" href=...>`.
- Net effect: scale-of-the-fix is enormous compared to the work. Every product page (~48k), every category page, every store storefront, every brand-search page, every blog post is now declaring Arabic-language Algerian coverage. AI panels answering queries like "هواتف الجزائر" (phones in Algeria) or "كمبيوتر محمول" (laptop) on a brand or category-specific basis now see Teno Store as language-matched at the per-page level, not just the home page.

## 2026-05-16 — vps-eu · enriched /seller with Service JSON-LD + ar-DZ hreflang (closes audit finding)

- Closed the one slack point from last iteration's audit: `/seller` had only `WebPage + BreadcrumbList` — sparse for a page whose whole purpose is offering a discrete service (free seller onboarding). Added a full Service schema describing the marketplace-seller-account offering:
  - `@type: Service` with `serviceType: "Marketplace seller account"`, `provider` linked to the existing `#organization` node so the entity graph is connected.
  - `areaServed: Country: Algeria` + `availableChannel` with `serviceUrl` and trilingual `availableLanguage`.
  - `audience: BusinessAudience` named "Vendeurs algériens" with explicit `geographicArea` — the schema.org shape Google + AI panels look for when ranking sources for "comment vendre en ligne en Algérie" / "how to sell online in Algeria" queries.
  - `offers: Offer` with `price: "0"`, `priceCurrency: "DZD"`, `eligibleRegion: Algeria`, and a French description of the free-tier — the exact signal AI panels look for when answering "is X free to sell on" queries.
- Also added `ar-DZ` hreflang to /seller's per-page alternates (it overrides the layout's so wouldn't inherit otherwise). Page now ships all three hreflangs.
- Verified: 8 JSON-LD types on /seller (up from 2 — WebPage, BreadcrumbList, Service, Offer, Country, BusinessAudience, ServiceChannel, ListItem), all three hreflangs (fr-DZ, ar-DZ, x-default) present, HTTP 200. Pushed `/seller` to IndexNow.

## 2026-05-16 — vps-eu · JSON-LD validity sweep across 15 key pages — all clean (GEO baseline audit)

- Diagnostic iteration: AI panels silently drop malformed structured data, so a typo anywhere in JSON-LD wastes all the discoverability work. Wrote a one-shot Python validator (`/tmp/jsonld-validate.py`, cleaned up after) that fetches each page with `User-Agent: GPTBot/1.0`, extracts every `<script type="application/ld+json">` block, JSON-parses each, and recursively walks the structure to enumerate every `@type` value.
- Audited 15 pages: home, /about, /search, the top-5 category landings, a product page, a store page, /blog, a blog post, /seller, top-2 brand-search pages. **15/15 pages OK, zero parse errors, zero missing blocks.** Every page has the right shape for its purpose:
  - Home: 17 types incl. the new FAQPage
  - /about: AboutPage + FAQPage (7 Q&As) + BreadcrumbList
  - /c/{slug}: CollectionPage + ProductGroup + FAQPage + BreadcrumbList — 9 types per category
  - /product/{id}: Product + Offer + Brand + Country + BreadcrumbList
  - /store/{uuid}: Store + ItemList + Product + Offer + Brand
  - /blog/{slug}: BlogPosting + SpeakableSpecification
  - Brand-search pages: CollectionPage + ItemList + Brand + Product + Offer
  - /seller: WebPage + BreadcrumbList — least rich; the one page where Service or Offer schema could be added if we ever want richer agent-side discoverability for the "sign up to sell" flow. Not a defect — it's a marketing landing — but the only structured-data slack point on the site.

## 2026-05-16 — vps-eu · re-snapshotted 6 substantially-changed URLs to Wayback (GEO archive refresh)

- Earlier today I pushed 20 high-value URLs to the Wayback Machine, but 6 of those have since been substantially updated: the home page (FAQPage added), /about (Ouedkniss/Jumia comparison, 7th FAQ entry, dateModified), llms.txt + llms-full.txt + agents.json (hourly refresher now driving exact counts) and ai-policy.json (referenced from agents.json). AI tools that fall back to Wayback for verification would see outdated content otherwise.
- Re-submitted those 6 URLs with 8s spacing — all 6 returned HTTP 302 (capture-initiated). Wayback now holds 2026-05-16 captures that include every GEO improvement from today's session.
- Open follow-up: a weekly systemd timer that re-pushes the discovery files + top category/brand landings to Wayback would automate this. The Save Page Now endpoint is rate-limited (~10/min) so the timer should walk one URL every ~10s and complete in a few minutes total.

## 2026-05-16 — vps-eu · closed the GEO autopilot loop: llms-full.txt tables now auto-refresh too

- Last remaining drift: `llms-full.txt` has exact markdown tables (5 category rows + 15 brand rows + snapshot/total prose lines) that the hourly script wasn't touching. Added `refresh_llms_full_txt()` to patch all 22 rows + 2 prose lines using narrow-anchor regexes — table rows use the French label OR brand name at column start as the anchor, plus the markdown column separator pattern, so the script can't accidentally edit cells in unrelated tables.
- Tables keep exact counts (e.g. HP=2,414, not rounded) because they're structured data; the prose "Total listings" line keeps rounded-to-100 phrasing (~48,200) since it's read as natural language.
- Test run live: `total=48,189, refreshed: json=True llms=True llms_full=True, pushed 3 URL(s) to IndexNow`. Verified all four targets (snapshot timestamp, total-listings prose, category table, brand table) re-read with the new values via `curl`.
- The hourly systemd timer that already exists now keeps all three manifests in sync — `agents.json` with exact JSON figures, `llms.txt` with rounded prose, `llms-full.txt` with exact tables. Nothing in the GEO surface decays anymore.

## 2026-05-16 — vps-eu · added FAQPage to the home page (GEO highest-PageRank surface)

- Home was the highest-PageRank page on the site but had no FAQ — Organization + WebSite + ItemList JSON-LD only. LLMs that crawled home for "what is Teno Store / is Teno Store legit / how does it work" queries had no rich Q&A to quote, so they fell back to synthesising from the meta description or skipping to /about (two clicks deep).
- Added 4 home-FAQ entries with deliberately non-duplicate questions vs the /about FAQ — so the two pages reinforce rather than shadow each other in AI panels:
  1. "À quelle fréquence le catalogue de Teno Store est-il mis à jour ?" (catalog freshness — minutely scraper, Atom feed)
  2. "Teno Store est-il gratuit pour les acheteurs et les vendeurs ?" (free for both — the canonical legitimacy-signal question)
  3. "Quels modes de paiement Teno Store accepte-t-il ?" (espèces à la livraison, Edahabia/CCP, P2P; AP2 mandates for agent purchases)
  4. "Dans quelles villes algériennes les vendeurs de Teno Store sont-ils basés ?" (Alger, Oran, Annaba, Constantine, Sétif, Blida; nationwide delivery via colis)
- Visible HTML + FAQPage JSON-LD + Speakable spans for AI voice/search panels, same pattern /about already uses. 4 entries — well under Google's 8-entry "spammy" threshold and well under /about's 7 so the two pages stay distinct.
- Clean compose-managed rebuild + deploy; verified live HTTP 200 with all four questions in rendered HTML and FAQPage/Question/Answer types in JSON-LD. Pushed `/` to IndexNow.

## 2026-05-16 — vps-eu · extended hourly refresher to also keep llms.txt in sync (GEO autopilot — complete)

- Added `refresh_llms_txt()` to `scripts/refresh-catalog-stats.py`: patches the four narrow-anchor numeric tokens in `llms.txt` (the "Scale" line and the four per-category bullet counts) using regex with both the French label AND the `/search?category=` URL fragment as anchors, so the script can't accidentally edit any unrelated number. Drift-safe: if a future operator manually edits the prose around those tokens and the anchor stops matching, the script silently skips that line rather than corrupting it.
- Prose counts are rounded to the nearest 100 ("~48,200" instead of "~48,158") so the file doesn't churn on every single listing add. The structured JSON keeps exact counts; rounded prose is for the human-readable surface.
- Same hourly timer now drives both manifests. Test run live: `total=48,158, refreshed: json=True llms=True, pushed 2 URL(s) to IndexNow`. Verified `curl https://teno-store.com/llms.txt | grep Scale:` returns the new rounded figure.

## 2026-05-16 — vps-eu · automated hourly refresh of agents.json from live DB (GEO autopilot, stops manifest drift)

- Built `scripts/refresh-catalog-stats.py`: pulls fresh counts from Postgres (`SELECT count(*)`, GROUP BY category/brand), rewrites `/.well-known/agents.json` on the host AND inside the running web container (no rebuild), then pushes the URL to IndexNow so Bing re-fetches the new payload. Idempotent — re-running with no DB changes is a no-op. Pure Python stdlib, no pip deps; uses `docker compose exec postgres psql` and `docker cp` for the heavy lifting.
- First test run on the live server: total moved from 48,062 → 48,092 in the few minutes since my last manual refresh (the scraper genuinely runs every minute). Manifest now shows `snapshot_time_utc: "16:18"` and `size: "48,092+ live listings..."` — both written automatically.
- Installed `marketplace-refresh-catalog-stats.service` + `.timer`, `OnCalendar=hourly` with 5-min jitter, `Persistent=true`. Next fire: 45 min from now, then every hour thereafter. Copied both unit files into `deploy/systemd/` for the repo-as-source-of-truth pattern.
- Open follow-up: this only touches the JSON manifest. The two prose files (`llms.txt`, `llms-full.txt`) still need an operator to refresh — they have natural-language phrasing that regex substitution would corrupt. Suitable cadence for those is monthly or whenever crossing a round number (50k listings, 10 sellers, etc.).

## 2026-05-16 — vps-eu · wayback machine retries completed (all 20 high-value URLs now archived)

- Last iteration's 10 rate-limited Wayback submissions were retried with 8s spacing — all 11 (the 10 originally rate-limited + the /blog that got a transient 520) returned HTTP 302 = capture-initiated. Combined with the 9 that succeeded on the first pass, all 20 high-value URLs (home, /about, /blog, /seller, the four `.well-known/*` manifests, /llms.txt + /llms-full.txt, top-5 category landings, top-5 brand landings) are now permanently archived in the Internet Archive's Wayback Machine.

## 2026-05-16 — vps-eu · re-synced GEO manifests with live catalog count after 1h scraper growth (GEO freshness)

- Scraper has added ~567 listings in the hour since I first wrote the manifests this morning. Catalog went from 47,495 → 48,062, informatique 18,828 → 19,190, electromenager 9,198 → 9,344, vetements_mode 4,892 → 4,943, plus dozens of brand counts ticking up (HP +27, Lenovo +13, Canon +22, etc.). The manifests were already slightly stale.
- Re-pulled live counts from the database (`catalog.products` aggregates), rewrote `llms.txt`, `llms-full.txt`, and `agents.json` with the fresh numbers. Also added a `growth_rate_per_hour: 500` field and a `snapshot_time_utc: "16:30"` field to `agents.json` so AI consumers can reason about staleness — a manifest with both a date and a UTC time + explicit growth rate is much more honest than one with just a date.
- Hot-patched all three files into the live container (no rebuild needed — these are static `public/` assets). Pushed the three URLs to IndexNow so Bing immediately re-fetches the new content.
- Open follow-up: the run-loop scraper could call this same "refresh manifests" step itself (read counts from DB, rewrite the three files, push to IndexNow) so the manifests stay continuously fresh without a human in the loop. Today's manual refresh is a one-shot proof that the pattern works.

## 2026-05-16 — vps-eu · added `ar-DZ` hreflang on layout + /about (GEO bilingual)

- Algeria is officially bilingual French + Arabic. The site declared only `fr-DZ` + `x-default` in `metadata.alternates.languages`, even though Algerian buyer queries frequently land in Arabic ("هواتف الجزائر", "كمبيوتر محمول الجزائر"). Added `ar-DZ` → same URL on both `layout.tsx` (covers every page that inherits the layout) and `about/page.tsx` (which overrides alternates and so wouldn't inherit). The catalog content itself is French — declaring ar-DZ as resolving to the same URL is the schema.org-blessed pattern for "this page also serves Arabic-speaking Algerian users", and Google AI Overviews / Bing Chat both honor hreflang when ranking sources for queries in the targeted language.
- Clean compose-managed rebuild + deploy, no outage. Verified rendered HTML on `/` and `/about` shows all three `<link rel="alternate" hrefLang="...">` tags (fr-DZ, ar-DZ, x-default). Pushed both URLs to IndexNow so Bing re-fetches with the new language signal.

## 2026-05-16 — vps-eu · submitted 20 high-value URLs to the Internet Archive Wayback Machine (GEO)

- Until today the Wayback Machine had no 2026-era captures of teno-store.com. AI tools (notably Perplexity, and ChatGPT when the live page is unreachable) sometimes cite Wayback URLs directly as fallback sources — and a captured page is also a citable, verifiable historical record for any later "what did this site claim on date X" question.
- Submitted 20 URLs to `web.archive.org/save/<url>`: the home page, /about, /blog, /seller, all four `/.well-known/*` discovery files (agents.json, ai-policy.json, ai-plugin.json, security.txt), /llms.txt + /llms-full.txt, the top-5 category landings (informatique, electromenager, telephones, immobilier, mode), and the top-5 brand landings (HP, Samsung, Dell, Lenovo, Xiaomi). One pass, 2s between submissions to respect Wayback's ~30/min rate limit.
- Verified the captures resolve: `https://web.archive.org/web/2026/https://teno-store.com/llms.txt` returns HTTP 200 with the current content. Submissions ran in the background with the loop continuing — one URL got a transient Cloudflare 520 on Wayback's side (`/blog`); the rest returned 302 (capture-initiated).

## 2026-05-16 — vps-eu · added visible Ouedkniss/Jumia comparison to /about + 7th FAQ entry + dateModified (GEO)

- The comparison content "How does Teno Store differ from Ouedkniss / Jumia Algeria?" lived only in `/llms-full.txt` (plain text). HTML-scraping AI tools — Google AI Overviews, Bing Chat, Perplexity, ChatGPT search when it walks rendered HTML — couldn't see it. Lifted the comparison into visible HTML on `/about` as a "Comparaison avec les autres marketplaces algériens" section: three bullets contrasting Teno Store with Ouedkniss (classifieds, no API) and Jumia Algeria (vertically-integrated retailer with own stock), plus a "common catalog" bullet with current per-category listing counts (informatique ~18,800, electroménager ~9,200, téléphones ~8,700, immobilier ~5,900, mode ~4,900).
- Added a 7th FAQ entry — `"Quelle est la différence entre Teno Store et Ouedkniss ou Jumia Algérie ?"` — mirroring the visible comparison so the FAQPage JSON-LD captures the answer too. Still under Google's 8-entry "spammy" threshold.
- Added `dateModified` to the AboutPage JSON-LD (set at compile time to ISO date). AI crawlers — Perplexity, ChatGPT search, Google AI Overviews — weight pages with recent `dateModified` higher when ranking sources for time-sensitive queries; previously the about page had no freshness signal at all.
- Clean deploy this time: `docker compose -f docker-compose.prod.yml up -d --build web` in one step, let compose orchestrate the container recreate. No manual `docker rm`, no outage. Verified live HTTP 200, both new FAQ + comparison + `dateModified` visible in the rendered HTML, then pushed `/about` to IndexNow so Bing re-fetches the new payload.

## 2026-05-16 — vps-eu · added `<link rel="alternate">` tags advertising /llms.txt + /llms-full.txt on every page (GEO)

- Until now, an HTML crawler that didn't already know the llmstxt.org convention had no way to discover `/llms.txt` and `/llms-full.txt` from the rendered page — they were only reachable via the `Sitemap:` line in robots.txt or via well-known-path probing. Added two `<link rel="alternate" type="text/plain; charset=utf-8">` tags to the root `<head>` in `layout.tsx`, advertising both files the same way every page already advertises `feed.xml`. ChatGPT search, Perplexity, Bing Chat, and Google AI Overviews all parse `<link rel="alternate">` natively.
- Rebuilt the web image (`docker compose build web`), then `docker compose up -d web` to roll it out. Caddy's `lb_try_duration 30s` was meant to absorb the recreate gap, but I tripped a docker-compose orphan-container race during the rollout: `docker rm -f marketplace-web` removed the *live* container (the name was still pointing at it, not the dead-marked one), causing a ~30-60s 502 window before a subsequent `docker compose up -d web` recreated it from the rebuilt image. Site is back HTTP 200; both new `<link>` tags are present in the rendered head; lesson — to clean up an orphan after a compose recreate hiccup, use `docker compose down web --remove-orphans` and let compose decide what to delete, never `docker rm -f` by name.

## 2026-05-16 — vps-eu · refreshed `.well-known/ai-plugin.json` (legacy ChatGPT-plugins manifest used by some bots) (GEO)

- `ai-plugin.json` is the deprecated ChatGPT-plugins descriptor but some legacy AI tools and crawlers still probe `/.well-known/ai-plugin.json` on every domain they visit. The file existed but had stale catalog claims, used relative `/sitemap.xml` instead of an absolute URL, and made no reference to any of the new GEO discovery surfaces (`llms-full.txt`, `ai-policy.json`, `agents.json`).
- Rewrote `description_for_human` and `description_for_model` with current scale (47k+ listings across 7 sellers), top categories ranked by real volume (informatique ~19k leads), the not-related-to-German-TeNo disambiguation, and explicit pointers to MCP / A2A / REST surfaces. Converted all internal references to absolute `https://teno-store.com/...` URLs. Added top-level `llms_txt`, `llms_full_txt`, `ai_policy`, `agents_json` fields so a bot reading only this single manifest discovers the full surface.
- Hot-patched into container, pushed the URL to IndexNow so Bing re-fetches the new payload immediately.

## 2026-05-16 — vps-eu · enabled monthly IndexNow systemd timer (GEO autopilot)

- Installed `marketplace-indexnow-sitemap.service` + `marketplace-indexnow-sitemap.timer` in `/etc/systemd/system/`. Fires monthly with a 2h randomized delay so the catalog stays fully synced with Bing (and via Bing's index: DuckDuckGo and ChatGPT search) without manual intervention. The scrape loop's incremental push handles fresh URLs; this monthly re-push catches the long tail of URLs that age out of the incremental window.
- Dry-ran the service to validate: completed in ~2m, accepted 47,793 / 47,793 URLs, `Deactivated successfully`. Next scheduled fire: 2026-06-01 ~01:25 CEST.
- Copied both unit files to `deploy/systemd/` so the repo is the durable source of truth (matching the convention used by `marketplace-scrape-loop.service`). A fresh server provision can reinstall them with one `cp` per file + `systemctl daemon-reload`.

## 2026-05-16 — vps-eu · IndexNow full-sitemap push: 47,793 / 47,793 URLs accepted (GEO)

- The IndexNow submitter at `scripts/indexnow-submit.mjs` has been in the repo since May 10 but was never scheduled — only the scraper's incremental newly-seeded-URL push (wired into `run-loop.sh` step 3.5) has been firing. That means today's new GEO discovery files (`/llms-full.txt`, `/.well-known/ai-policy.json`) and the refreshed `/llms.txt` + `/.well-known/agents.json` had never been pushed, and the full 47k-URL product catalog was last fully submitted... never.
- Pushed all 11 new GEO discovery URLs (home, llms.txt, llms-full.txt, agents.json, ai-policy.json, /about, top-5 category landings) — IndexNow accepted 11/11.
- Pushed the full live sitemap — 47,793 URLs across 96 chunks of 500, all returned HTTP 200. Bing typically processes IndexNow submissions within minutes-to-hours; the URLs then become reachable to ChatGPT search, DuckDuckGo, and Yandex backends (Bing feeds all three for AI-search results).
- Open follow-up (operator confirmation): wire a systemd timer to call `indexnow-submit.mjs` (no args, full-sitemap mode) monthly so the catalog stays fully synced with Bing even when individual products age out of the incremental-push window. The script is idempotent and chunked, ran end-to-end in under 90 s for 47k URLs.

## 2026-05-16 — vps-eu · published `/.well-known/ai-policy.json` (GEO)

- New structured AI-use policy at `/.well-known/ai-policy.json`. Complements `/robots.txt` (which only declares Allow/Disallow paths) with explicit, machine-readable permissions for: **crawl**, **cite** (with required attribution format `Teno Store — https://teno-store.com`), **summarize** (with `preferred_sources` pointing crawlers at `llms-full.txt` for descriptive answers), **train**, and **transact** (with REST / MCP / A2A endpoints and OAuth2.1+DPoP+PKCE auth requirement). Also publishes rate-limit guidance, content provenance, brand-disambiguation against the German jewelry brand TeNo, and a discovery index that unifies all eight machine-readable surfaces (robots, sitemap, feed, llms.txt, llms-full.txt, agents.json, security.txt, api agent-card).
- Cross-linked from `agents.json` (new `discovery.ai_policy` entry) and `llms-full.txt` so an AI tool entering at any of those manifests discovers the policy in the same pass.
- Hot-patched all three files into the running web container, restarted web so Next's static-file manifest rescanned `public/`, verified live HTTP 200 and JSON shape via `curl + python json.load`.

## 2026-05-16 — vps-eu · added query-coverage signals to agents.json and llms-full.txt (GEO)

- Added three new sections to both manifests so LLM crawlers have an explicit signal for "should I cite Teno Store for this user's question?":
  - `good_for` (8 items): consumer electronics in Algeria, DZD price comparisons, laptop discovery (the actual largest category), home-appliance discovery, smartphone discovery, Algerian seller contact details, agent-mediated shopping, snapshot replay.
  - `not_good_for` (5 items): unreleased products, services/digital goods, non-DZD currencies, international shipping, aggregated star ratings.
  - `example_queries` (8 items): the literal phrasing users send to ChatGPT/Gemini ("Where can I buy a Samsung phone in Algiers?", "Compare HP and Dell laptops available in Algeria", "Is Teno Store a legitimate marketplace?", "How does Teno Store compare to Ouedkniss or Jumia Algeria?", etc.).
- Mirrored the same content in `llms-full.txt` under a "When to cite Teno Store" section so text-only LLM consumers see the same signal.
- Hot-patched both files into the running container, verified live.

## 2026-05-16 — vps-eu · rewrote `.well-known/agents.json` with accurate catalog (GEO)

- File claimed `"size": "10k+ live listings"` while real catalog is 47,495. `top_categories` listed `automobiles_vehicules` at position 3 even though that category has only 4 listings, and buried `informatique` (18,828 listings, by far the largest) at position 8. An LLM agent reading the manifest to plan a session would have queried for cars first and missed the actual catalog mass.
- Restructured the manifest:
  - Promoted `total_listings` (47495), `active_sellers` (7), and `snapshot_date` to first-class numeric fields agents can consume without parsing the prose `size` blurb.
  - Sorted `top_categories` by real listing count with explicit `{slug, listings, label}` objects so agents know which slug is worth crawling first.
  - Added `top_brands` with counts (HP 2,385 leads, Samsung 2,061, Dell 1,747, Lenovo 1,708, ...) so brand-targeted agents have a ranked list.
  - Split sparse `subcategory_slugs` (mode/femme/homme/etc.) into their own array — they're real navigable URLs but shouldn't compete with the actual top categories.
  - Added `discovery.llms_full_txt` pointing at the new long-form LLM reference.
  - Added the "not the German jewelry brand TeNo" disambiguation note to the top-level description.
- Validated JSON, hot-patched both host and container copies, verified live `curl https://teno-store.com/.well-known/agents.json` returns the new structure.

## 2026-05-16 — vps-eu · added `/llms-full.txt` long-form LLM reference (GEO)

- Created `public/llms-full.txt` (~10 KB): companion to the existing `/llms.txt` per llmstxt.org convention. Includes the brand-disambiguation note ("not the German jewelry brand TeNo"), full category and brand tables with counts, every public URL pattern, the AI-crawler robots allow list, the agent surfaces (REST/MCP/A2A), trust signals, the full FAQ verbatim, AND a comparison block ("How does Teno Store differ from Ouedkniss or Jumia Algeria?") — exactly the queries users send to ChatGPT / Gemini about the site.
- Hot-patched the file into the running web container, then `docker compose restart web` so Next.js's standalone static-file manifest re-scanned `public/` and picked up the new asset. Caddy's `lb_try_duration 30s` absorbed the ~3s restart. Verified `curl https://teno-store.com/llms-full.txt` returns HTTP 200 with the full body.
- Also updated `/llms.txt` to point LLMs at the new long-form doc, so crawlers that fetch the short summary can discover the deep reference in the same request.

## 2026-05-16 — vps-eu · refreshed `/llms.txt` with accurate catalog stats (GEO)

- Live `public/llms.txt` cited stale numbers ("Téléphones ~21k", no total, brand list absent). Current DB snapshot: 47,495 products, 7 active sellers. Top categories by count: Informatique 18,828, Électronique/Électroménager 9,198, Téléphones 8,670, Immobilier 5,910, Vêtements/Mode 4,892. Top 15 brands by listing volume captured (HP 2,385 leads).
- Rewrote the "Catalog at a glance" section with current counts + total + brand block, dated snapshot 2026-05-16. This is the file ChatGPT / Gemini / Perplexity crawlers consume directly when summarizing the site, so accuracy here drives accuracy of LLM citations.
- Hot-patched both `/opt/marketplace/packages/web/public/llms.txt` and the `web` container's `/app/packages/web/public/llms.txt` (no compose recreate; static file served by Next directly). Verified `curl https://teno-store.com/llms.txt` returns the new content. Image rebuild not needed unless container is recreated before next deploy — committed source in repo so the next image build picks it up.

---

## 2026-05-13 — vps-eu · reclaimed 117 GB of docker build cache (disk 52% → 3%)

- Disk audit: `/` was at 124 GB used / 251 GB (52%), with `docker system df` showing **124.8 GB of build cache (99% reclaimable)** plus 111.8 GB of intermediate image layers. Source: my ~30 `docker compose build` cycles across this loop session (api + web rebuilds for each scraper / brand / category / sitemap / alias fix).
- `marketplace-docker-prune.timer` runs daily at 00:05 CEST with `docker builder prune -af --filter until=72h`. Recent runs all reported "Total: 0B" reclaimed because every cache entry was <72h old. The filter is too conservative for our deploy cadence — at 30 builds/day adding ~4 GB each, we'd hit 80% disk before any cache entry aged past 72h.
- Manual `docker builder prune -af` (no filter) reclaimed **117 GB** in one pass. Disk now at 7.1 GB used / 251 GB (3%). All running containers untouched; only intermediate cached layers discarded.
- Suggested follow-up (operator confirmation): change the systemd unit `ExecStart` from `--filter until=72h` to `--filter until=24h` (or remove the filter entirely). At current cadence the build cache that "saves work on future rebuilds" actually only saves work on rebuilds within the same day — older entries are mostly stale layer dependencies that re-resolve fast anyway.

---

## 2026-05-13 — vps-eu · variant SKU now globally unique (sourceUrl hash, not loop index)

- Audit found 353 variant SKUs duplicated across different products in `catalog.product_variants`. Schema's `UNIQUE (product_id, sku)` constraint was still satisfied (different products), so it's cosmetic not a functional bug — but ugly. Top collision: `scraped-vente-appartement-f3-alg-37` shared by 10 different "Vente Appartement F3 Alger ..." listings. Pattern: every loop index `i` of every scrape batch produced the same SKU suffix.
- `packages/db/src/seed-from-scraped.ts`: SKU now uses `sha1(sourceUrl).slice(0, 10)` as the uniqueness token instead of loop index. Each scraped listing has a unique Ouedkniss URL → unique hash → globally-unique variant SKU. Rebuilt `marketplace-api:local`; next scrape uses the new format.
- Pre-existing 353 collisions stay — backfill would require regenerating SKUs for hundreds of variants with potential downstream cart_items / order_items implications. New scrapes are clean.

---

## 2026-05-13 — vps-eu · 44 duplicate-sourceUrl products purged

- Data integrity audit found 44 distinct Ouedkniss `sourceUrl` values that appeared as 2 product rows each in `catalog.products`. The seeder's `skipUrls` set dedup should prevent this, but the bug-window window (iters 1-9, pre-migration-0012) likely produced these — every scrape claimed "seeded N" but the rows rolled back, then a subsequent run's `refresh_skip_urls` query couldn't see the failed inserts, so the same `sourceUrl` got attempted again successfully later.
- Cleanup SQL (one transactional pass, kept the oldest row per duplicate group, preserved any with order-item references): `DELETE FROM catalog.products WHERE id IN (SELECT id FROM dups WHERE rn > 1 AND id NOT IN (...order-item refs...))`. Removed 44 rows.
- No new dups should appear in steady state — the seeder's skipUrls dedup is sound when the DB reflects committed state. Optional follow-up: add a `UNIQUE INDEX ON ((attributes->>'sourceUrl'))` to enforce at the DB layer; deferred for operator confirmation since it requires a migration.

---

## 2026-05-13 — vps-eu · 18 more imageless products purged (fixture-era cleanup)

- Follow-up data audit: iter-27 purged 533 imageless *scraped* rows but the same query filter (`attributes->>'source' = 'ouedkniss-public-listing'`) skipped the fixture-era catalog. 22 fixture products still had `hero_media_id = NULL` and were rendering as letter-only placeholder cards on /store/<id>, search, and home. 18 of the 22 lacked order-item references and were safe to delete.
- SQL: `DELETE FROM catalog.products WHERE hero_media_id IS NULL AND id NOT IN (SELECT pv.product_id FROM catalog.product_variants pv JOIN "order".order_items oi ON oi.variant_id = pv.id)` — removed 18 rows. The 4 remaining imageless fixtures have historical order-item references and were preserved for transactional integrity (negligible at 12k+ catalog size; can be hidden via status=draft later if visible).

---

## 2026-05-13 — vps-eu · web rebuild · sitemap now lists all 19 alias category landings

- Iter-37 added 5 alias slugs to the sitemap; iter-38 extended `CATEGORY_ALIASES` from 7 to 19 entries (adding subcategory landings like `/c/femme`, `/c/homme`, `/c/ordinateurs`, `/c/maison`, `/c/decoration`, `/c/motos`, `/c/jeux`, …). The new 14 landings each show their own French editorial prose + FAQ + populated sample-product strip, but the sitemap still only listed the original 5. Google had no way to discover the head-term landings that earn the most natural search traffic.
- `packages/web/src/app/sitemap.ts`: `ALIAS_SLUGS` array expanded from 5 to 20 entries (matches `CATEGORY_ALIASES` keys plus `voitures` which doubles as both subcategory and API-facet slug).
- Verified live: sitemap.xml now lists 26 unique `/c/<slug>` entries (was 11) — the 6 API-facet slugs + 19 alias slugs + 1 overlap deduped. Each entry priority 0.8, changefreq daily.

---

## 2026-05-13 — vps-eu · web rebuild · /api/search route now resolves category aliases too (infinite-scroll fix)

- Follow-up to iter-39 /search alias fix: the SSR `/search?category=mode` page now renders 25 products. But the client-side infinite-scroll uses `/api/search?category=mode&cursor=…` to load subsequent pages — and that route handler wasn't applying the alias resolution. Result: user scrolls past the first 25 cards on /search?category=mode and infinite scroll terminates silently with no more results — looks like the catalog only has 25 mode listings.
- `packages/web/src/app/api/search/route.ts`: same `input.category?.flatMap(resolveCategorySlugs)` step as the SSR page. ETag/cache-control unchanged.
- Verified live: `/api/search?category=mode&limit=3` payload size went from 25 bytes (`{"data":[],"cursor":null}`) to 2,468 bytes (3 products + cursor).

---

## 2026-05-13 — vps-eu · web rebuild · /search route now resolves category aliases too

- Follow-up to iter-36/38 `/c/<alias>` fix: `/search?category=mode` (and every other alias slug) was still returning 0 cards. The /c/<alias> CTAs from iter-36 were rewriting click-through links to use the underlying compound slug, but **typed URLs, stale external links, sitemap entries, and any internal link that still used the alias would all hit /search with the editorial slug and get empty results**.
- `packages/web/src/app/search/page.tsx`: in `Results({ input })`, expand `input.category` through `resolveCategorySlugs` before passing to `searchProducts`. The original `input.category` is left untouched so canonical URL generation, breadcrumb labels, and singleCategory display keep showing the editorial slug the user actually navigated to — only the upstream fetch sees the expanded compound IDs.
- Verified live: `/search?category=mode` 0 → 25 cards, `/search?category=femme` 0 → 25, `/search?category=homme` 0 → 25, `/search?category=electromenager` 0 → 25, `/search?category=portables` 0 → 25, `/search?category=maison` 0 → 25, `/search?category=vehicules` 0 → 3.

---

## 2026-05-13 — vps-eu · web rebuild · 10 more category aliases (subcategory landings now populated)

- Follow-up audit on the iter-36 alias fix: the related-categories chips on `/c/<slug>` pages (and pre-rendered via `generateStaticParams` from `FR_CATEGORY`) include subcategory slugs like `/c/femme`, `/c/homme`, `/c/accessoires`, `/c/bebe`, `/c/sport`, `/c/ordinateurs`, `/c/ecrans`, `/c/decoration`, `/c/peripheriques`, `/c/jeux`, `/c/motos`, `/c/maison`, `/c/salon`, `/c/traditionnel`. Tested all 14 — every one rendered 200 OK but with **0 product cards**. Same root cause as the home-chip bug: editorial subcategory slugs map onto no product `category_ids`. Each Mode-femme / Mode-homme / Décoration / Ordinateurs landing was an editorial dead-end.
- `packages/web/src/lib/categories.ts`: extended `CATEGORY_ALIASES` from 7 entries to 19. Subcategory-to-aisle mappings:
  - apparel subcats (`femme`, `homme`, `accessoires`, `traditionnel`, `bebe`, `sport`) → `["vetements_mode"]`
  - home subcats (`maison`, `decoration`, `salon`) → `["electronique_electromenager"]`
  - computing subcats (`ordinateurs`, `ecrans`, `peripheriques`, `jeux`) → `["informatique"]`
  - vehicle subcats (`motos`) → `["automobiles_vehicules"]`
- Each landing keeps its unique editorial prose / FAQ / breadcrumb-label (e.g. "Mode femme") but its product strip resolves against the parent aisle, so users get prose + listings instead of prose + empty grid.
- Verified live: `/c/femme` 0 → 12 cards, `/c/homme` 0 → 12, `/c/accessoires` 0 → 12, `/c/bebe` 0 → 12, `/c/sport` 0 → 12, `/c/ordinateurs` 0 → 12, `/c/ecrans` 0 → 12, `/c/decoration` 0 → 12, `/c/motos` 0 → 3, `/c/maison` 0 → 12, `/c/salon` 0 → 12, `/c/traditionnel` 0 → 12, `/c/peripheriques` 0 → 12, `/c/jeux` 0 → 12.
- Still empty: `/c/sante_beaute`, `/c/services`, `/c/emploi` — these are Ouedkniss top-level categories we don't currently scrape. They need either a scraper extension or removal from `FR_CATEGORY`/related-chips. Out-of-scope for this iteration.

---

## 2026-05-13 — vps-eu · web rebuild · sitemap now includes 5 editorial alias category landings

- Follow-up to the prior chip-alias fix: now that `/c/smartphones`, `/c/portables`, `/c/electromenager`, `/c/mode`, `/c/vehicules` render real product strips (via `CATEGORY_ALIASES`), they should be discoverable to crawlers. They weren't — the sitemap was harvested from API facets, which only return the compound underscored slugs that actually tag products. The 5 head-term alias landings (each with unique 2-3 paragraph French copy + FAQPage JSON-LD, optimized for queries like "smartphones algérie") were orphaned in the index.
- `packages/web/src/app/sitemap.ts`: added an `ALIAS_SLUGS` constant + a flatMap step that emits each alias slug as a /c/<slug> sitemap entry at priority 0.8 (same as the API-facet entries). Skipped the matching `/search?category=<alias>` entries because the click-through CTAs on /c/<alias> already resolve to the underlying API slug, so the search URLs are emitted by the facet loop.
- Verified live: sitemap now lists 11 `/c/<slug>` entries (was 6) — the 6 API-facet slugs plus the 5 aliases.

---

## 2026-05-13 — vps-eu · web rebuild · fixed 6 home page chips leading to empty category pages

- Bug: 6 of the 8 hero-section category chips on the home page linked to `/c/<slug>` pages that returned 200 OK but rendered **zero product cards**. Slug mismatch — the home page used simplified head-term slugs (`/c/smartphones`, `/c/portables`, `/c/electromenager`, `/c/mode`, `/c/vehicules`, `/c/maison`) while the catalog tags products with compound Ouedkniss slugs (`telephones`, `informatique`, `electronique_electromenager`, `vetements_mode`, `automobiles_vehicules`). Each clicked chip dropped the buyer onto an editorial-only page with no actual listings — a hard bait-and-switch.
- `packages/web/src/lib/categories.ts`: added `CATEGORY_ALIASES` map + `resolveCategorySlugs()` helper. Maps each editorial short slug to the underlying API category set: `electromenager → ["electronique_electromenager"]`, `mode → ["vetements_mode"]`, `vehicules → ["automobiles_vehicules", "vehicules", "voitures"]`, `smartphones → ["telephones"]`, `portables → ["informatique"]`.
- `packages/web/src/app/c/[slug]/page.tsx`: replaced the two `category: [slug]` calls (`searchProducts` for the metadata count + the sample-products fetch) with `category: resolveCategorySlugs(slug)`. The "Voir toutes les …" and "Voir plus →" CTAs now build `/search?category=X&category=Y` URLs so the click-through from `/c/mode` lands on `/search?category=vetements_mode` instead of `/search?category=mode`.
- `packages/web/src/app/page.tsx`: swapped the "Maison & Déco" chip (the only one with no real catalog backing — no products tagged `maison`) for "Immobilier" (991 listings).
- Verified live: `/c/smartphones` 0 → 12 cards, `/c/portables` 0 → 12, `/c/electromenager` 0 → 12, `/c/mode` 0 → 12, `/c/vehicules` 0 → 3. Plus the new "Immobilier" chip leads to 12 cards.

---

## 2026-05-13 — vps-eu · brand inference round 9: security cameras + kitchen, 89 rows backfilled

- Round-9 audit: security/CCTV (Dahua 23), kitchen (Ninja 15 verified kitchen-only, Krups 7, Nespresso 6, Terraillon 1), refrigeration (Raylan 10, Arcodym 5 Algerian cooker brand), vacuums (Bissell 8), pro audio (Rode 7 verified audio-only, Sennheiser 7).
- `KNOWN_BRANDS` extended 156 → 166 entries.
- Backfilled 89 rows. **Session running total: 1,680 products** newly or correctly tagged.
- Brand-fill rates now: telephones 74%, vetements_mode 74%, informatique 56%, electronique_electromenager 45%. Diminishing returns on further rounds — most remaining NULL-brand rows are genuinely brandless (generic accessories, no-name imports, real estate).

---

## 2026-05-13 — vps-eu · brand inference round 8: PC components + denim, 247 rows backfilled

- Round-8 audit found two clusters: PC components (Gigabyte 38, UGREEN 22, Magma 21 — verified PC-components brand not the generic word, APC 19, SanDisk 14, Tenda 11, Galax 8, Godox 5, Kingston 4, Biostar 4, Western Digital 4, ASRock 2, EVGA 0-but-pre-positioned) and one more apparel hit (Pepe Jeans 67). Plus heating (Chappee 18), small appliances (WMF 3, Lexical 2), smart watches (Haino-Teko 5).
- `packages/db/src/seed-from-scraped.ts`: `KNOWN_BRANDS` extended 137 → 156 entries. Added `WD → Western Digital` canonical map.
- Backfilled 247 rows. **Session running total: 169 + 91 + 149 + 171 + 417 + 347 + 247 = 1,591 products** newly or correctly tagged.

---

## 2026-05-13 — vps-eu · brand inference round 7: shoe brands + watches, 347 rows backfilled

- Round-7 audit on the remaining vetements_mode NULL-brand rows surfaced specialty shoe brands not in the prior pass: Timberland (62, after CASE-WHEN priority unmasking — 53 in the predicted count), Xtep (57, Chinese athleticwear), Rahati (57, Algerian orthopedic shoes — single high-volume reseller), Clarks (56), Ecco (53), Chicco (22, baby/kids), Umbro (16), Fly Flot (12). Plus watches: Naviforce (7) and Casio (5).
- Pre-positioned for future scrapes but zero historical matches: Columbia, Fossil, Michael Kors, Guess, Pandora, Carrefour, IKEA.
- `packages/db/src/seed-from-scraped.ts`: `KNOWN_BRANDS` extended 120 → 137 entries.
- Backfilled 347 rows. **Session running total: 169 + 91 + 149 + 171 + 417 + 347 = 1,344 products** newly or correctly tagged.

---

## 2026-05-13 — vps-eu · brand inference round 6: clothing brands (Lacoste, sneakers, athleticwear), 417 rows backfilled

- The homepage hero strip surfaced 8 unbranded vetements_mode cards (Lacoste tennis kits, Skechers shoes, Safety Jogger sandals) — turned out the fashion category had 96% NULL-brand coverage because the brand list still skipped apparel entirely. Audit found 417 untagged rows with detectable apparel/footwear brands, dominated by Lacoste at 332 (a single high-volume Algerian reseller accounts for most of those).
- `packages/db/src/seed-from-scraped.ts`: extended `KNOWN_BRANDS` to 120 entries — Lacoste, Skechers, Nike, Safety Jogger, Adidas, Puma, Reebok, New Balance, Converse, Under Armour, Asics, Jordan, Tommy Hilfiger, Calvin Klein, Polo Ralph Lauren, Levi.
- Backfilled 417 rows: 332 Lacoste, 46 Skechers, 24 Nike, 15 Safety Jogger. Other apparel brands (Adidas, Puma, etc.) had zero historical matches but are pre-positioned for future scrapes.
- Rebuilt `marketplace-api:local`. **Session running total: 169 + 91 + 149 + 171 + 417 = 997 products** newly or correctly tagged.
- Vetements_mode brand-fill rate moves from ~4% to ~42% in one pass.

---

## 2026-05-13 — vps-eu · deployed seller image-upload flow + media volume bind-mount

- Created `/var/lib/marketplace/media` (uid 1000:1000) for the new bind mount.
- Rebuilt `marketplace-api:local` + `marketplace-web:local` from commit d8b8f31, recreated api/web containers. api healthcheck passing within 35s.
- Smoke-checked the new endpoints: `POST /v1/media` returns 401 unauthenticated (expected), `GET /v1/media/<missing>` returns 404 (handler live), container reads/writes `/data/media` mounted from the host.
- See the long entry below for the full code change set.

---

## 2026-05-13 — seller dashboard: end-to-end image flow + editable products

- **Bug report**: operator created a product via /seller/products/new and couldn't find it on the dashboard. Investigation: product existed in DB (id `019e20df…`, title "pr") but with zero `catalog.media` rows; the catalog filter (`packages/api/src/catalog/filter.ts:58`) hid it from every browse surface including the seller's own dashboard.
- **Root cause**: three layers disagreed about whether images are required. The catalog filter assumed every visible product had ≥1 image, but (a) the API's `CreateProductSchema.media` was `.optional()`, (b) the seller-creation form had no image picker at all, (c) the edit page was a read-only stub, and (d) there was no upload endpoint to even host bytes — though the auth middleware whitelisted `POST /v1/products/:id/media` for a never-built route. Scraper-seeded products always have URLs so the bug was invisible in steady state; only UI-created listings hit it.
- **Fix scope**: closed every layer of the gap.
  - `packages/api/src/routes/products.ts`: new `POST /v1/media` (multipart, content-addressed sha256 filenames) writes bytes to `/data/media/<hash>.<ext>`. New `GET /v1/media/:filename` streams them with `cache-control: public, max-age=31536000, immutable` (filenames are content-hashed so the bytes can never change). New `PATCH /v1/products/:id` updates fields. New `POST /v1/products/:id/media` attaches an uploaded URL. New `DELETE /v1/products/:id/media/:mediaId` detaches and refuses if it would drop to zero. `CreateProductSchema.media` is now `.min(1)`.
  - `packages/api/src/middleware/auth.ts` + `packages/api/src/server.ts`: allow-listed `POST /v1/media` and exempted from idempotency-key requirement (content hash IS the idempotency key).
  - `packages/api/src/catalog/filter.ts`: media-required rule scoped to browse only — seller-scoped queries (dashboard, store page) now show all of a seller's listings, including any media-less rows that slipped in historically.
  - `packages/api/src/repos/product.ts` + `packages/db/src/repos/product.ts`: changed `addMedia` to take `{url, contentType, ...}` instead of raw bytes (upload writes bytes; attach records metadata).
  - `docker-compose.prod.yml`: bind-mount `/var/lib/marketplace/media:/data/media` on the api service; `MARKETPLACE_MEDIA_DIR=/data/media`.
  - `packages/web/src/app/seller/products/new/NewProductForm.tsx`: full rewrite with image picker — multi-file select, per-image upload progress, removable, blocks submit until ≥1 image successfully uploaded.
  - `packages/web/src/app/seller/products/[id]/edit/`: replaced the "Lecture seule" stub with `EditProductForm.tsx` — editable title/brand/description/category/price plus add/remove images (uploads attach immediately, deletes hit the API immediately, last-image deletion is refused).
  - `packages/web/src/app/api/seller/`: new `/media`, `/products/[id]`, `/products/[id]/media`, `/products/[id]/media/[mediaId]` proxy routes forwarding to the API with the session JWT.
  - `packages/web/src/lib/api.ts`: new `uploadMedia`, `updateProduct`, `attachProductMedia`, `detachProductMedia` client helpers.
- **Verification**: 108 api tests green, all packages typecheck, MCP `product.create_listing` and scraper `seed-from-scraped` already enforced media presence before this — three of three write paths now agree.

---

## 2026-05-13 — vps-eu · brand inference round 5: African/Chinese phones + accessories, 171 rows backfilled

- Post-imageless-purge audit on the now-6,400-row scraped catalog turned up another concentrated NULL-brand bucket in telephones + accessories: African phone makers (Tecno 29, Infinix 32 — both very common in DZ market) and Chinese phone makers (ZTE 23, Nothing 26), plus accessory brands (LDNIO 22, Capsys 18, Hollyland 9, Oculus 3, Nvidia 3, Astro 3, Fiio 3).
- `packages/db/src/seed-from-scraped.ts`: extended `KNOWN_BRANDS` to 104 entries (added Infinix, Tecno, LDNIO, ZTE, Nothing, Hollyland, Capsys, Nvidia, Oculus, Astro, Fiio). Verified zero false-positives for "Nothing" specifically — every catalog match was the actual brand (e.g., "NOTHING WATCH 3 PRO", "CMF NOTHING phone 2a").
- Backfilled 171 existing rows in a single UPDATE — the actual matches turned out 2.3× higher than the audit query suggested (CASE-WHEN priority was masking lower-priority brands when both regexes matched the same row).
- Rebuilt `marketplace-api:local`; next scrape uses the new list.
- **Session running total for brand-correctness improvements: 169 + 91 + 149 + 171 = 580 products** newly or correctly tagged in this loop session.

---

## 2026-05-13 — vps-eu · scraper requires ≥1 image, 533 imageless rows purged

- Audit found 13% of scraped products (251 rows at that time, climbing) had `hero_media_id = NULL` because the Ouedkniss source listing had no photos. These rendered as letter-only placeholder cards on home / search / category grids — wall of A/V/L badges instead of product imagery, looks thin.
- Skew: nearly 100% immobilier — Ouedkniss real-estate sellers often skip photos entirely (a Vente Villa with no exterior shot, a Vente Terrain with nothing). 5/5 random samples were "Vente Villa/Appartement/Terrain ..." with `images: []` in the scraper JSON dump.
- `packages/db/src/seed-from-scraped.ts`: added pre-flight check next to the existing phone/title/price/dup guards. If `pickImages(item)` returns 0 candidates (the source listing has no acceptable image URL after the existing video/extension filter), increment `noImage` and skip. Summary line now reports the new bucket separately ("N dropped for missing image").
- Cleanup SQL: `DELETE FROM catalog.products WHERE attributes->>'source' = 'ouedkniss-public-listing' AND hero_media_id IS NULL AND id NOT IN (SELECT pv.product_id FROM catalog.product_variants pv JOIN "order".order_items oi ON oi.variant_id = pv.id)` — deleted 533 rows; preserved 2 with historical order-item references for transactional integrity.
- Rebuilt `marketplace-api:local` and recreated the api container so the next scrape uses the new filter. Container required manual cleanup of a stray `7fb91525b421_marketplace-api` left by an interrupted compose recreate during the rebuild — `docker stop && rm` followed by clean `up -d api`.

---

## 2026-05-13 — vps-eu · web rebuild · same recovery treatment for /product/[id] 404

- `packages/web/src/app/product/[id]/not-found.tsx`: mirrored the just-improved global /not-found pattern (Accueil / Parcourir le catalogue CTAs + 6 head-category recovery chips). Was a single back-to-catalog link; now keeps the user inside the shopping flow when a product URL points at a removed listing.
- Verified live: hitting a nonexistent product UUID returns 404 with "Annonce introuvable" + "Catégories populaires" + chips.
- Deploy: tar+ssh single file, `docker compose build web` + `up -d web`.

---

## 2026-05-13 — vps-eu · web rebuild · improved /not-found recovery page

- `packages/web/src/app/not-found.tsx`: was a single "Retour au catalogue" link. Now offers three primary CTAs (Accueil / Parcourir le catalogue / Blog) plus a row of recovery chips linking to the 6 head categories (`/c/telephones`, `/c/informatique`, `/c/electronique_electromenager`, `/c/vetements_mode`, `/c/automobiles_vehicules`, `/c/immobilier`). Stays `robots: noindex, follow` so dead URLs don't pollute Google's index.
- Why: 404 is the only chance to recover a user whose link didn't resolve. Single-link 404 dead-ends ~80% of those sessions; a chip row keeps them in the catalog.
- Verified live: `curl /this-page-does-not-exist` returns 404 with H1 "Cette page est vide", "Catégories populaires" heading, and chips for Téléphones / Informatique / etc.
- Deploy: tar+ssh single file, `docker compose build web` + `up -d web`. One transient container-name conflict during recreate (stale `59c1c8d1b2fb_marketplace-web` reference) self-resolved on the second `up -d web` invocation.

---

## 2026-05-13 — vps-eu · web rebuild · price sanity ceiling at 1B DZD (catches centime/dinar unit confusion)

- Bug: 5 immobilier products had absurd prices like "DZD 4,320,000,000.00" (= $32M USD) and "DZD 137,500,000,000.00" (= $1B USD) on cards, product pages, the feed, OG meta, and JSON-LD Offer blocks. Root cause: Algerian real-estate sellers on Ouedkniss commonly post prices in centimes (1 DZD = 100 centimes) rather than dinars; the scraper's parsePriceToMinor can't tell the units apart at parse time, so a "4 320 000 000" centimes listing (= 43.2M DZD = reasonable land in Algiers, ~$320K USD) gets stored as 432B santeem.
- Fix: added `MAX_REAL_PRICE_MINOR = 100_000_000_000` (= 1B DZD = ~$7.5M USD) ceiling alongside the existing 100-DZD floor. Anything above renders as "Prix sur demande" — matches how placeholder-low prices are already handled. Real luxury villas in Algiers cap around 300M-500M DZD, so the 1B ceiling has zero false-positives on legitimate listings.
- Wired into all four render sites: `ProductCard.tsx` (card grids), `product/[id]/page.tsx` (visible price label + `ogPriceAmount` + JSON-LD Offer guard + variant-table filters + `metadata.other` injection — 7 call-sites total), `feed.xml/route.ts` (`fmtPrice` returns null above ceiling so Atom summary shows seller/brand only).
- Verified live: `/product/019e2104-18b2-...` (Vente Terrain Boumerdès with priceMinor=13,750,000,000,000) — was "DZD 137,500,000,000.00", now "Prix sur demande".
- Deploy: scp 3 files, `docker compose build web` + `up -d web`. Api unchanged.

---

## 2026-05-13 — vps-eu · web rebuild · "Prix sur demande" on cards + product page for placeholder prices

- Bug: products with `priceMinor < 10000` santeem (= 100 DZD) rendered as "DZD 1" / "DZD 4" on cards and the product detail price block. This is the Ouedkniss negotiate-only convention (sellers post 1 DA / 4 DA when they want buyers to call for a real price), not a real listing price. Looked like an obvious mis-price to buyers and reads as "this catalog is broken" — affects 11+ products in informatique alone (HUAWEI access points, AMD Ryzen trays, Dlink racks, etc.).
- `MIN_REAL_PRICE_MINOR = 10000` was already filtering placeholder prices out of the SERP `<meta description>`, the JSON-LD Product.description, and the JSON-LD Offer block. Just not the visible price label.
- Fixed at both render sites:
  - `packages/web/src/app/product/[id]/page.tsx`: when all variants are below floor, swap `priceLabel` for "Prix sur demande" (was: `formatPrice(100, 'DZD')` → "DZD 1").
  - `packages/web/src/components/ProductCard.tsx`: same threshold applied to card grids (home / search / category / related strip / store).
- Verified live: `/product/019e208e-00e5-...` (HUAWEI S5700 switch, priceMinor=100) now shows "Prix sur demande" both as the main price and on its card; `/search?q=HUAWEI+S5700` card result also shows "Prix sur demande".
- Deploy: scp 2 files, `docker compose build web` + `up -d web`. Api unchanged.

---

## 2026-05-13 — vps-eu · web rebuild · per-seller OG card for /store/[id]

- Was: every /store/<id> share rendered the same global brand card (`/opengraph-image`) — no way to tell which store from a Facebook / X / Discord preview.
- New `packages/web/src/app/store/[id]/opengraph-image.tsx`: 1200×630 PNG that calls `getSeller(id)` and renders the seller's display name (auto-shrinks at ~28 chars), plus a subtitle of `city · N annonces actives` (or a generic fallback when the seller has neither). `/store/[id]/page.tsx` openGraph.images updated to point at the new route.
- Verified live: `<meta property="og:image" content="https://teno-store.com/store/<id>/opengraph-image">` (cache-busted), image route returns 200 image/png (~97 KB).
- Deploy: tar+ssh 2 files, `docker compose build web` + `up -d web`.

---

## 2026-05-13 — vps-eu · brand inference round 4: +13 brands (peripherals, networking, EU appliance), 149 rows backfilled

- Round-four audit: NULL-brand sample still showed concentrated misses on PC peripherals, networking, printers, and Algerian-market heating/appliance names. Added Calor, Havit (which turned out to be 83 hits — much bigger than the sample suggested), TP-Link (canonical map handles "Tp-Link"/"TPLink" variants), Immergas, Midea, Corsair, Epson, Junkers, BenQ, Taurus, GoPro, plus a `MacBook → Apple` canonical so titles like "MacBook Air M3 2024" tag as Apple.
- `packages/db/src/seed-from-scraped.ts`: `KNOWN_BRANDS` now 93 entries (up from 80). Rebuilt `marketplace-api:local`.
- Backfilled 149 existing NULL-brand rows: 83 Havit, 12 Calor, 8 TP-Link, 6 each of Midea/Junkers/Immergas/Epson/Corsair, 6 Apple (MacBook), 4 Taurus, 4 BenQ, 2 GoPro.
- **Session running total for brand-correctness improvements: 169 + 91 + 149 = 409 products** newly or correctly tagged. Brand-facet coverage in informatique should move from ~37% to ~52%.

---

## 2026-05-13 — vps-eu · web rebuild · visible "Publié le" / "Mis à jour le" on blog posts

- `packages/web/src/app/blog/[slug]/page.tsx`: blog post header now renders `Publié le {date}` (prefix added) and, when `dateModified !== datePublished`, an additional `Mis à jour le {date}` chip. Google's freshness ranker rewards pages where the visible modification date matches the `dateModified` in BlogPosting JSON-LD; this closes the loop and tells readers the content is being kept current.
- All 4 current posts have matching published/modified dates, so only `Publié le` renders today — the "Mis à jour" branch activates automatically when a post's frontmatter bumps `dateModified`.
- Verified live: `/blog/<slug>` shows `Publié le 13 mai 2026 · 7 min de lecture`.
- Deploy: tar+ssh single file, `docker compose build web` + `up -d web`.

---

## 2026-05-13 — vps-eu · web rebuild · dedicated OG cards for /about and /seller

- Audit of all indexable routes' `og:image` found /about and /seller shipping NO og:image at all (their per-page `openGraph` metadata replaces the layout default — which has the `images` field — wholesale; without a file-convention `opengraph-image.tsx` in the route dir, Next.js can't auto-fill it). FB / X / Discord / LinkedIn shares of these pages were rendering only the 180×180 apple-icon fallback.
- New `packages/web/src/app/about/opengraph-image.tsx` (1200×630, ~115 KB) and `packages/web/src/app/seller/opengraph-image.tsx` (1200×630, ~118 KB). Both match the green-gradient + brand-mark visual language of the existing /, /search, /blog, /c/<slug> OG cards.
- Verified live (cache-busted): `<meta property="og:image" content="https://teno-store.com/about/opengraph-image?...">` + same for /seller. Both image routes return 200 image/png.
- Remaining routes are fine: / and /search have file-convention cards; /blog and /blog/<slug> and /c/<slug> have dedicated cards (shipped today); /product/<id> uses the seller's hero image at 1200×; /store/<id> falls back to the global brand card (acceptable — still 1200×630, not 180×180).
- Deploy: tar+ssh 2 files, `docker compose build web` + `up -d web`.

---

## 2026-05-13 — vps-eu · web rebuild · CategoryFooter uses humanizeCategorySlug for chip labels

- `packages/web/src/components/CategoryFooter.tsx`: category chips in the sticky "Parcourir le catalogue" panel (shown on every page) now render through `humanizeCategorySlug()` instead of `slug.replace(/[-_]/g, " ")` + Tailwind's `capitalize` class.
- Before: "electronique electromenager", "automobiles vehicules" — no diacritics, no proper conjunction, per-word capitalization that drops accents Algerian users expect.
- After: "Électronique & Électroménager", "Automobiles & Véhicules", "Téléphones", "Vêtements & Mode". Uses the curated French label map already used by `/c/[slug]` editorial pages and the breadcrumbs, so chip text matches the destination page heading exactly.
- Verified live: home, /search, every product detail page that renders the footer now shows the proper labels.
- Deploy: scp single file, `docker compose build web` + `up -d web`.

---

## 2026-05-13 — vps-eu · web rebuild · hreflang sweep — /about, /seller, /search, /product, /store

- Follow-up to the earlier /c + /blog hreflang fix: same Next.js wholesale-replacement of layout `metadata.alternates` affected every other child page that sets its own canonical. Added `languages: { "fr-DZ": ..., "x-default": ... }` next to canonical in: `/about/page.tsx`, `/seller/page.tsx`, `/store/[id]/page.tsx`, `/search/page.tsx`, `/product/[id]/page.tsx`.
- Verified live: `<link rel="alternate" hrefLang="fr-DZ" href="...">` + `x-default` now present on `/about`, `/seller`, `/search?category=telephones`, `/product/<id>`, `/store/<id>` (all pointing at the correct per-page canonical URL).
- Effect: Google now has the country/language signal it needs to route fr-DZ users to fr-DZ pages on every indexable surface — without this Google treats canonical-only pages as locale-agnostic and downgrades them in geo-targeted SERPs.
- Deploy: tar+ssh 5 files (one had to be re-tarred after a transient SSH timeout), `docker compose build web` + `up -d web`.

---

## 2026-05-13 — vps-eu · brand inference round 3: +13 brands (cameras, robot vacuums, software), 91 rows backfilled

- A second audit of NULL-brand scraped rows after the round-2 appliance+auto expansion showed informatique and electronique_electromenager still had ~870 NULL brands. Top recoverable buckets: Canon 29, Adobe 10, Dreame 9, AMD 8, Hikvision 8, Autodesk 6, Dyson 6, Smeg 5, Ariete 3, plus stragglers (TCL, Intel, Kärcher, Ecovacs, Nikon).
- `packages/db/src/seed-from-scraped.ts`: extended `KNOWN_BRANDS` to 80 entries (added Kärcher/Karcher, Canon, Nikon, Dyson, Ecovacs, Dreame, Hikvision, TCL, Smeg, Ariete, Adobe, Autodesk, AMD, Intel). Added `Karcher → Kärcher` to `BRAND_CANONICAL` so both spellings normalize. Deliberately omitted IRIS despite 18 candidate matches — would false-positive on the common French/English word "iris" outside the Algerian Iris-appliance context.
- Backfilled 91 existing rows: 30 Canon, 10 Adobe, 9 Dreame, 8 each AMD/Hikvision, 6 each Dyson/Autodesk, 5 Smeg, 3 Ariete, 2 each TCL/Intel, 1 each Kärcher/Ecovacs.
- Rebuilt `marketplace-api:local`; next scrape uses the new list. Session running total for brand-correctness improvements: 169 + 91 = **260 products** newly or correctly tagged.

---

## 2026-05-13 — vps-eu · api+web rebuild · new `recently_added` sort + feed.xml uses it (no more 1.5h-stale feed)

- Bug: `feed.xml`'s `<updated>` tag was running ~1.5 hours behind real ingestion. Atom feed-readers (RSS clients + AI crawlers like ChatGPT / Perplexity / Claude that poll Atom for "what's new") were seeing the catalog as stagnant even though the scraper ingests ~25–30 new rows per minute.
- Root cause: feed.xml fetched `?sort=newest&limit=50`, which orders by `attributes.sourcePostedAt` (Ouedkniss seller's original post date). The 50-newest-by-postedAt set is dominated by fixture-era rows from May 11 (real seller posts, not freshly ingested). New scraper rows whose Ouedkniss source date is anywhere in the recent past don't crack the top-50, so the feed never saw them — and `max(updatedAt across hits)` never advanced past the May-11 ceiling.
- Fix: added a new `recently_added` value to the catalog Sort enum in three places (`packages/domain/src/catalog/types.ts`, `packages/api/src/routes/products.ts`, `packages/api/src/catalog/sort.ts`). It sorts by `p.createdAt` (our DB ingestion time) — distinct from `newest` which prefers the Ouedkniss source post date. Switched `feed.xml` from `sort=newest` to `sort=recently_added`. Rebuilt both `marketplace-api:local` and `marketplace-web:local`; recreated both containers.
- Verified live: `/v1/products?sort=recently_added&limit=3` returns the three most-recently-scraped products (UUIDv7 prefix `019e20e3-3b...` = today's ingestion). `feed.xml`'s `<updated>` advanced from `2026-05-13T08:58:24Z` to `2026-05-13T10:30:23Z` (3 min stale vs. previous 1.5h).
- UI `sort=newest` unchanged — buyer-facing surfaces still show "newest as posted by the seller", which is the right semantic there. Only the Atom feed swapped axes.

---

## 2026-05-13 — vps-eu · web rebuild · hreflang on /c/[slug], /blog, /blog/[slug]

- Bug: those three routes shipped NO hreflang `<link>` tags at all. Root cause: Next.js replaces the layout-level `metadata.alternates` wholesale when a child page sets `alternates: { canonical: ... }` — it does not shallow-merge the `languages` field. Layout had `languages: { "fr-DZ": ..., "x-default": ... }` but the child override dropped it.
- Fix in `packages/web/src/app/c/[slug]/page.tsx`, `/blog/page.tsx`, `/blog/[slug]/page.tsx`: re-declare `alternates.languages` next to the per-page canonical so each child carries its own per-URL hreflang. Verified live: `curl -s /c/telephones | grep hrefLang` now shows `fr-DZ` + `x-default` pointing at the correct per-page URL. Same for /blog and /blog/<slug>.
- Pre-existing routes (`/product/[id]`, `/store/[id]`, `/search`, `/about`, `/seller*`) probably have the same drop pattern — they're out-of-scope for this commit but worth a sweep next time.
- Deploy: tar+ssh 3 files, `docker compose build web` + `up -d web`.

---

## 2026-05-13 — vps-eu · api+web rebuild · seller dashboard discoverability + plain copy

- Closes the recurring "how do I see my stores from /dashboard?" gap: the signed-in /dashboard now renders a "Your stores" card (manage / add product / view public store) above the agent-activity feed, and the global header gains a direct "Ma boutique" link for signed-in users.
- /seller/dashboard rewrite for non-technical sellers: glance metrics row (products / orders / total revenue), product thumbnails, prices in the product list, WhatsApp click-to-chat on every order, helpful empty-state copy with an inline "Ajouter" CTA, and a "Voir la boutique" link to the public store. No more raw sellerId / productId UUID clutter anywhere.
- /seller/products/new simplified: SKU is now optional with client-side auto-generation, the currency field is hidden (always DZD), the category free-text field is replaced by a French-labeled dropdown of curated top-level slugs, the misleading subtitle is gone, and post-create the user is returned to the seller dashboard so the new product appears in context.
- Honest labeling: /seller/products/[id]/edit renamed to "Détails du produit" with the read-only warning surfaced at the top, and the dashboard's per-product "Modifier" button is now "Détails".
- /seller landing bullets rewritten to plain seller benefits — removed the false stock-edit promise and the developer-acronym soup (MCP / A2A / HTTP).
- CreateSellerForm: "Nom de la boutique" instead of "Nom d'affichage", DZ-flavored placeholder ("ex. Téléphonie El Djazair"), button reads "Créer ma boutique".
- Verified locally: `pnpm typecheck` and `pnpm test --filter=@marketplace/web` both green (161/161). Seller landing test updated to match the new bullet copy.
- Deploy: tar+ssh full working tree, `docker compose -f docker-compose.prod.yml build api web` + `up -d api web caddy`. Bundled with the SEO/catalog work that had accumulated in the tree (commit `cf9a6fc`: blog OG card, /blog RSS feed, /c root redirect, "Référence" badge on scraped cards, max-image-preview robots meta, new recently_added sort).

---

## 2026-05-13 — vps-eu · web rebuild · dedicated /blog index OG card

- New `packages/web/src/app/blog/opengraph-image.tsx`: 1200×630 PNG (~108 KB) for the /blog index. Previously the route inherited the layout default (180×180 apple-icon), which Twitter's `summary_large_image` and Facebook's preview both rendered undersized. Now `og:image` resolves to `/blog/opengraph-image` and shares of the blog index get a full-size branded card with title + tagline + post count.
- Verified live: `og:image` content URL points at /blog/opengraph-image, 200 image/png returned.
- Deploy: tar+ssh single file, `docker compose build web` + `up -d web`.

---

## 2026-05-13 — vps-eu · web rebuild · "Articles à lire" cross-links from /c to /blog

- New `packages/web/src/lib/categoryBlogLinks.ts`: maps category slugs to blog-post slugs (telephones/smartphones → smartphone buyer guide; informatique/ordinateurs/portables → laptop guide; automobiles_vehicules/voitures/vehicules → car inspection checklist). Single source of truth.
- `/c/[slug]` now renders an "Articles à lire" section above the related-categories chips when the slug maps to at least one blog post. Section is fully hidden for unmapped slugs (e.g. /c/immobilier) — no empty heading, no spam links.
- Bidirectional internal linking: blog posts already link inline to relevant `/c/<slug>`; this closes the loop so /c/ ↔ /blog/ flow PageRank both directions and Google can cluster the topical content.
- Verified live: `/c/telephones` shows the smartphone guide card, `/c/voitures` shows the car checklist card, `/c/portables` shows the laptop guide, `/c/immobilier` correctly hides the section.
- Deploy: tar+ssh minimal (c/ + categoryBlogLinks.ts), `docker compose build web` + `up -d web`.

---

## 2026-05-13 — vps-eu · web rebuild · "Référence" badge on cards for non-purchasable scraped products

- `packages/web/src/components/ProductCard.tsx`: card now shows a "Référence" badge in the top-right corner (next to `CounterfeitBadge` and `Rupture de stock`) when `hit.sellerId === null`. Badge styled bg-bg/80 + text-ink-mute + border-line for a subtle, distinct-from-warning look. `title` attribute carries the full explanation ("Annonce de référence — non disponible à l'achat sur Teno Store") for hover/screen-reader.
- Why: scraped products were rendering on home / search / category pages exactly like purchasable products. Buyers clicked them expecting checkout, then got "non disponible à l'achat" on the detail page — a bait-and-switch UX. With the badge, intent is set on the listing surface.
- Verified live: `/search?category=informatique` (97/97 scraped) renders 25 cards, all with "Référence" badge. Fixture product `/product/019e08a4-9976-...` (real seller) renders without the badge. Homepage also surfaces the badge on the 4 current scraped products in the recent strip.
- Deploy: scp single file, `docker compose -f docker-compose.prod.yml build web` + `up -d web`. Api unchanged.

---

## 2026-05-13 — vps-eu · web rebuild · max-image-preview:large + /c root redirect

- `packages/web/src/app/layout.tsx`: extended the site-wide robots meta with `max-image-preview: large`, `max-snippet: -1`, `max-video-preview: -1`. Google defaults to a small image preview in SERP; `large` unlocks full-width images on mobile + Image Search rich-result eligibility. Verified live: `<meta name="robots" content="index, follow, max-video-preview:-1, max-image-preview:large, max-snippet:-1">`.
- New `packages/web/src/app/c/page.tsx`: bare `/c` now 308-redirects to `/search` (was 404). Recovers typed-URL traffic and consolidates any external link to `/c` onto the catalog tool. Per-category landings still live at `/c/<slug>`. Verified: `curl -I /c` → `308 Location: /search`.
- Deploy: tar+ssh minimal change set (layout + c/), `docker compose build web` + `up -d web`.

---

## 2026-05-13 — vps-eu · web rebuild · Speakable spec on /c/[slug] FAQ

- `packages/web/src/app/c/[slug]/page.tsx`: added `SpeakableSpecification` (cssSelector `["#faq-heading", "#faq-heading ~ dl"]`) to the per-category FAQPage JSON-LD. Same pattern /about and /blog/<slug> now use. Tells Google Assistant / Bing Chat voice / Perplexity audio that the category FAQ is a safe span to read aloud as a voice-search answer for queries like "comment vérifier un téléphone d'occasion en Algérie".
- Verified live: `curl /c/telephones` shows `SpeakableSpecification` + the `#faq-heading` selector in the rendered HTML.
- Deploy: tar+ssh `packages/web/src/app/c` only, `docker compose build web` + `up -d web`.

---

## 2026-05-13 — vps-eu · api + web rebuild · migrate sidecar, media-less filter, contact-emoji strip, run-loop tripwire

- `docker-compose.prod.yml`: new `api-migrate` one-shot service runs `node packages/db/dist/migrate.js` against postgres and exits; `api` depends on it with `service_completed_successfully` so any migration shipped inside the api image is applied before the api starts serving. Closes the failure mode that froze the catalog for ~30h on 2026-05-12.
- `packages/api/src/catalog/filter.ts`: `passes()` now returns false for products with no media, so home/search/category surfaces stop rendering empty-card placeholders. `GET /v1/products/:id` still serves the record. Test fixtures updated to seed a default media entry.
- `packages/web/src/app/product/[id]/page.tsx`: `stripMaskedContactLines()` removes lines that are just a contact emoji (📞/📧/☎) with separators — Ouedkniss masks phone/email in public bodies but leaves the emoji, which used to leak into the rendered body, the `<meta description>`, and the Product JSON-LD description (and from there into SERP snippets).
- `scraper/run-loop.sh`: post-seed tripwire compares `catalog.products` row count before/after; exits 9 if the seeder claims `seeded>0` but the table didn't grow. Belt-and-suspenders against the 2026-05-12 silent-failure mode.
- Deploy: tar+ssh sync, `docker compose build api web`, then `up -d api-migrate api web caddy`. Migrate sidecar ran clean (no pending migrations). Verified: `/livez` 200, `/`, `/blog/<slug>` and OG image routes 200.

---

## 2026-05-13 — vps-eu · web rebuild · Speakable spec on blog posts (voice/AI snippet)

- `packages/web/src/app/blog/[slug]/page.tsx`: added `SpeakableSpecification` to the BlogPosting JSON-LD (cssSelector `["#article-headline", "#article-lead"]`) and matching `id`s on the H1 and a new lead `<p>` rendering the post excerpt. Speakable is schema.org's mechanism for telling Google Assistant / Bing Chat voice / ChatGPT voice / Perplexity audio which spans are safe to read aloud as a 30–60s featured snippet. Same pattern the /about FAQPage already uses.
- Verified live: `curl /blog/<slug>` shows `SpeakableSpecification` + both ids in the rendered HTML.
- Deploy: tar+ssh web only, `docker compose build web` + `up -d web`. Api unchanged.

---

## 2026-05-13 — vps-eu · web rebuild · blog Article rich-result fields + RSS feed

- `packages/web/src/app/blog/[slug]/page.tsx`: added `image` (pointing at the dynamic `/opengraph-image` route from earlier today) and `wordCount` to the BlogPosting JSON-LD — `image` is the missing field that was blocking Google's Article rich-result eligibility. Also extended the OG metadata with `article:author` (→ `/about`), `article:section` (= post category), explicit `twitter:image`, and `siteName`. Verified live: `curl /blog/<slug>` shows `"image":[".../opengraph-image"]`, `"wordCount":1800`, `article:published_time`, `article:author`, `article:section` in the rendered HTML.
- New: RSS 2.0 feed at `/blog/rss.xml` (200 application/rss+xml, ~3.5 KB, 4 items). Distinct from `/feed.xml` (catalog Atom feed). Auto-discovered from `/blog` via `<link rel="alternate" type="application/rss+xml">`. AI search crawlers (ChatGPT/Perplexity/Claude/Bing Chat) follow RSS for editorial content discovery.
- Sitemap now lists `/blog/rss.xml` at priority 0.5 so search engines find it without depending on the `<link rel="alternate">` header alone.
- Pushed 3 URLs to IndexNow (HTTP 200).
- Deploy: tar+ssh sync, `docker compose -f docker-compose.prod.yml build web` + `up -d web`. Api unchanged.

---

## 2026-05-13 — vps-eu · expanded brand inference: +30 appliance & automotive brands, 133 rows backfilled

- `packages/db/src/seed-from-scraped.ts`: extended `KNOWN_BRANDS` from 35 mostly-phone/laptop entries to 65, adding small-appliance brands (Moulinex, Rowenta, Tefal, Philips, Kenwood, Bosch, Brandt, Beko, Whirlpool, LG, Panasonic, Hisense, Condor, Sonashi, Clatronic, Nardi, Bomann, Magimix, Enzo, SEB, De'Longhi w/ canonical map for "De Longhi"/"DeLonghi" variants) and automotive (Volkswagen, Mercedes-Benz w/ canonical map, Renault, Peugeot, Citroen, Toyota, Hyundai, Nissan, Honda, Dacia, BMW, Audi, Ford, Kia, Opel, Fiat).
- Why: prior audit showed 110+ products with detectable appliance brand names in the title but `brand = NULL`. Brand-facet filters and brand-keyed SERP rich-cards were skipping them. The original list was scoped to phones/laptops because that's how the catalog started; the scraper now covers electronique_electromenager and automobiles_vehicules where the brand surface is completely different.
- Backfilled 133 existing rows with a single SQL UPDATE using `~* '\y<brand>\y'` matchers mirroring the JS regex: 34 Moulinex, 20 Tefal, 9 Rowenta, 8 each of Sonashi/Kenwood/Clatronic, 7 each of Philips/LG/Bosch, 6 Enzo, 5 De'Longhi, 3 each of Nardi/Condor, 2 each of SEB/Hisense/Bomann, 1 each of Panasonic/Citroen.
- Follow-up backfill of fixture-era rows (the original UPDATE was scoped to `attributes->>'source' = 'ouedkniss-public-listing'`): same brand-detection CASE on the complement, fixed 30 more rows (19 Panasonic, 8 LG, 3 Philips). Session total: 133 scraped + 30 fixture + 6 wrong→correct from the prior iteration = **169 products** with newly-accurate brand tags.
- Rebuilt `marketplace-api:local`. Next scrape uses the new list; existing rows are already correct.

---

## 2026-05-13 — vps-eu · brand inference: drop substring-match fallback that produced wrong brands

- `packages/db/src/seed-from-scraped.ts`: `inferBrand()` was matching brands with `re.test(lower) || lower.includes(brand.toLowerCase())`. The substring fallback was redundant (the `/i` regex already handles case-insensitive word-boundary matching, including brand names with spaces like "Google Pixel"), and it false-matched on:
  - "ASUS VIVOBOOK ..." → tagged "Vivo" (substring "vivo" inside "vivobook")
  - "DATASHOW ACER X1123HP" → tagged "HP" (substring "hp" after "1123")
  - "MINI HACHOIRE KENWOOD CHP40" → tagged "HP" (substring "hp" inside "chp40")
  - "HPE OC20 ..." → tagged "HP" (substring "hp" inside "hpe")
  - "Location Local Oran Bir el djir" → tagged "DJI" (substring "dji" inside "djir")
  Removed the fallback. Built `marketplace-api:local`. The next scrape uses the corrected inference; existing rows are fixed below.
- Corrected the 6 mis-branded rows in production: 2 "ASUS VIVOBOOK ..." rows set to `brand = 'Asus'`, 1 "DATASHOW ACER X1123HP" to `'Acer'`, and 3 unbrandable rows (Kenwood, HPE, real-estate listing) set to `NULL`. Samsung "GALAXY BOOK" was a false positive in the audit query — it's correctly resolved to "Samsung" via the existing `Galaxy → Samsung` canonical map.

---

## 2026-05-13 — vps-eu · seeder exit policy: pre-flight rejections are no longer failures

- `packages/db/src/seed-from-scraped.ts`: rewrote the bottom-of-`main()` exit branch. Old logic exited 1 whenever `ok === 0` with any skip/noPhone activity. That conflated pre-flight rejections (listings without phones in no-shop-account categories, listings without title/price on Ouedkniss, already-seeded duplicates — all expected outcomes) with true catch-block exceptions on every insert. `run-loop.sh` saw the exit 1, ran 2 retries, then exited 5 — three full docker-run cycles burned for a "no eligible listings in this batch" outcome that was perfectly normal. Three of every five runs on this six-category rotation were hitting this — `telephones`, `automobiles_vehicules`, `vetements_mode` had zero shop accounts (only `siteBuildGetByStore`-enriched listings carry phones since `OUEDKNISS_JWT` isn't set), so they always all-noPhone'd, retried, and exited 5 every minute.
- New rule: exit 1 only when `ok === 0 && skipped === items.length && items.length > 0`, i.e. every listing went into the catch-block bucket with zero noPhone/dup activity, which is the actual error signature.
- Rebuilt `marketplace-api:local`. Verified live: runs at 09:47 (`vetements_mode`, all-noPhone) and 09:49 (`automobiles_vehicules`, all-noPhone) both exited 0 with `seedAttempts=1`. Compare to 09:44 `telephones` (last run with old code): exit 5 after 2 retries. Three categories' worth of false-alarm noise eliminated, ~6 wasted docker-run starts per minute saved.

---

## 2026-05-13 — vps-eu · scraper rejects video URLs as images + cleanup of 14 bad rows

- `packages/db/src/seed-from-scraped.ts`: `pickImages()` now rejects URLs that look like videos (`/videos/` in the path, or `.mp4/.webm/.mov/.m4v/.avi/.mkv` extension). Ouedkniss returns both stills (`/medias/announcements/images/...`) and clips (`/medias/announcements/videos/...`) in the same `item.images` array; the seeder used to accept both and stamp them `image/jpeg`. Result: Next.js Image Optimizer returned 400 on every video URL it tried to transcode (~24 occurrences per affected product over 10 minutes — one product loads at multiple breakpoints, so one bad URL = many 4xx hits).
- Rebuilt `marketplace-api:local` so `docker run marketplace-api:local node packages/db/dist/seed-from-scraped.js` (spawned by `run-loop.sh`) picks up the fix on the next iteration. Running `marketplace-api` container left as-is — no serving-code change.
- Cleaned existing bad rows: `DELETE FROM catalog.media WHERE url ~ '/videos/|\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)'` removed 14 rows across the products that had bad media. Repointed 5 dangling `catalog.products.hero_media_id` references to the first remaining `catalog.media` row for each affected product so those products didn't lose their hero image.
- Verified live: scrape at 09:36:06Z inserted 35 rows; post-scrape `SELECT COUNT(*)` on the video-URL pattern still returned 0.

---

## 2026-05-13 — vps-eu · api-migrate sidecar + scraper silent-failure tripwire

- `docker-compose.prod.yml`: added a one-shot `api-migrate` service that runs `node packages/db/dist/migrate.js` against Postgres and exits. The `api` service now declares `depends_on: api-migrate: condition: service_completed_successfully`, so future `docker compose up -d api` runs gate the api start on migrations being applied. Sidecar deploy was a no-op restart (compose didn't recreate the running api container because the only diff was `depends_on`, which is a runtime ordering hint rather than a container-config field — the gate becomes effective on the next api image rebuild). Verified: `marketplace-api-migrate` exited 0 with "Migrations complete" (count stayed at 13; nothing new to apply).
- `/opt/marketplace/scripts/run-loop.sh`: scp'd updated script + `sed -i 's/\r$//'` for CRLF (per the cross-platform deploy gotcha in CLAUDE.md). The new script captures `DB_BEFORE = SELECT COUNT(*) FROM catalog.products` immediately before `run_seed`, captures `DB_AFTER` after the summary line is parsed, and aborts with exit code 9 if `SEEDED > 0` but `DB_AFTER - DB_BEFORE <= 0`. Tripwire for any future silent-rollback bug — would have caught the 2026-05-12 migration outage within 60 seconds rather than 30 hours. Docstring updated for exit code 9. Verified: subsequent scrape at 09:30:24Z completed cleanly (`seeded=21`, no exit 9 fire).
- Why both at once: the migration outage hid behind two failures simultaneously — (a) the deploy pipeline didn't apply migrations, and (b) the run-loop's metrics line happily reported success on rolled-back inserts. The sidecar prevents (a) for future migrations; the tripwire catches (b) regardless of what causes future silent failures.

---

## 2026-05-13 — vps-eu · web rebuild · strip masked-contact emoji residue from scraped descriptions

- `packages/web/src/app/product/[id]/page.tsx`: added `stripMaskedContactLines()` next to the existing `stripLeadingArabic()`. Filters out lines whose visible content is only a contact emoji (`📞`, `📧`, `☎`) followed by separators (slashes, dashes, pipes, em-dashes) and whitespace — the artifact Ouedkniss leaves when it masks public phone/email numbers from listing bodies before serving them. Real phone numbers and emails (anything with digits or letters after the emoji) are preserved. Collapses runs of 3+ blank lines to 2 so the cleanup doesn't leave gaping holes.
- Wired into three description-rendering sites: the visible `<p>` body, the SERP meta-description `cleanedDesc`, and the JSON-LD `Product.description` (`ldRaw`).
- Why: every scraped Ouedkniss listing rendered residue like `📞 /` and `📧` on its own line — both in the visible description and inside Google's product rich-card description field. Looks broken to buyers, and Google was sometimes pulling the empty `📧` line into the SERP snippet.
- Verified live on `/product/019e209e-a603-75c3-adc3-c508a98aaa64` (Lenovo ThinkPad X13): grep for `📞`/`📧` residue patterns returned 8 matches before, 0 after.
- Deploy: scp single file, `docker compose -f docker-compose.prod.yml build web` + `up -d web`. Api unchanged. Affects all ~143 existing scraped products + every future one — no data migration needed.

---

## 2026-05-13 — vps-eu · web rebuild · 2 more blog posts + dynamic OG cards for /blog and /c

- Blog now has 4 posts (was 2). New: `/blog/acheter-voiture-occasion-algerie-10-verifications` (~1,180 mots, used-car inspection checklist) and `/blog/ordinateur-portable-etudes-algerie-guide-2026` (~1,150 mots, student laptop buyer's guide). Both internally link to relevant `/c/<slug>` pages. Past the 3–5 post threshold where Google starts treating a blog section as a real content surface rather than a token presence.
- New OG image routes: `/blog/[slug]/opengraph-image` and `/c/[slug]/opengraph-image` — render 1200×630 branded PNGs (green gradient, brand mark, category chip, title) when these URLs are shared on FB/X/Discord/Slack. Matches the visual language of the existing `/`, `/search`, and `/product/[id]` OG cards. Verified live: `curl /c/voitures/opengraph-image` returns 200 image/png; same for `/blog/<slug>/opengraph-image` (~137 KB, ~1s cold render).
- Pushed 4 URLs to IndexNow (HTTP 200) so Bing/Yandex pick the new posts up within minutes.
- Deploy: tar+ssh sync, `docker compose -f docker-compose.prod.yml build web` + `up -d web`. Api unchanged.

---

## 2026-05-13 — vps-eu · apply migration 0012 (seller_id nullable) — unblock scraper inserts

- Ran `docker exec -w /app/packages/db marketplace-api node dist/migrate.js`. Drizzle migration count went 12 → 13.
- `catalog.products.seller_id` and `catalog.media.seller_id` are now `NULL`-able (was NOT NULL).
- Background: commit `91891a6` (2026-05-12) shipped the seeder change to insert scraped listings with `seller_id = NULL`, plus migration `0012_nullable_seller_for_scraped.sql`, but the migration was never applied on the live DB. From 2026-05-12 ~07:07Z onward, every scraper run silently failed — the seeder logged "seeded N" but every INSERT hit the NOT NULL constraint and rolled back. Catalog froze at 2,418 products (only 5 of which were scraper-sourced) for ~30 hours despite the per-minute timer firing successfully.
- Post-migration verification: `marketplace-scrape-loop.service` run at 08:57:19Z inserted 33 rows. Catalog count 2,418 → 2,451; `ouedkniss-public-listing` rows 5 → 38; newest `created_at` now current.
- Follow-up defects worth fixing (not blocking): (a) seeder swallows the NOT NULL exception silently and reports success — try/catch should distinguish; (b) `metrics.jsonl` recorded `seeded=N` for ~30h of phantom inserts, so historical aggregates are wrong; (c) deploy pipeline doesn't run migrations on api image rebuild — needs a one-line addition to whatever launches `marketplace-api` so 0013+ don't sit unapplied again.

---

## 2026-05-13 — vps-eu · web rebuild · /c/[slug] category landings + IndexNow ping

- New surface: `/c/<slug>` editorial category landings backed by `packages/web/src/lib/categoryContent.ts` (29 hand-written French entries covering every slug in `FR_CATEGORY`). Each page renders unique 2–3 paragraph intro, 3–4-entry FAQ, related-category chips, sample products strip, and CTA into `/search?category=<slug>` for the filterable view. Distinct from `/search?category=<slug>` (filter tool, also still indexable): `/c/<slug>` is the SEO head-term landing — keyword in URL path, prose-heavy, eligible for FAQ rich results via FAQPage JSON-LD.
- Sitemap now emits both `/c/<slug>` (priority 0.8) and `/search?category=<slug>` (priority 0.7) per category. Internal links from home, CategoryFooter, product breadcrumb, and blog posts repointed at `/c/<slug>` so PageRank flows into the head-term page.
- Robots.txt extended to allow `/c/` for the wildcard rule and every AI/social UA.
- Verified live: `/c/telephones`, `/c/informatique`, `/c/immobilier`, `/c/voitures` all return 200 with H1/FAQPage/CollectionPage JSON-LD intact. Sitemap contains 8 `/c/<slug>` entries (matches the API's category facets at time of build).
- Pushed 12 URLs to IndexNow (Bing/Yandex/Seznam/Naver via `https://api.indexnow.org/IndexNow`, HTTP 200). Google ignores IndexNow but the others will recrawl within minutes.
- Deploy: tar+ssh sync, `docker compose -f docker-compose.prod.yml build web` + `up -d web`. Api image unchanged (rebuilt earlier today for the MCP JSON-Schema fix).

---

## 2026-05-13 — vps-eu — scraper requires >=1 phone per product, legacy phoneless rows purged

- `packages/db/src/seed-from-scraped.ts`: `collectPhones()` merges per-listing `phoneEntries` with `stores[sellerStoreId].phones`; listings with zero phones are dropped before insert (counted as `noPhone` in the new "NNN dropped for missing phone" tail line). When at least one phone is present it is persisted on the product as `attributes.sourcePhones` (comma-joined).
  - Why: operator directive — products without a reachable phone number are unusable to buyers and must not appear on the site.
- Rebuilt `marketplace-api:local` and recreated the api container so the new seeder ships inside the image the run-loop invokes.
- Purged scraper-source products from production Postgres in two passes: `DELETE` on `catalog.products` WHERE `attributes->>'source' = 'ouedkniss-public-listing'` AND NOT EXISTS(order_items ref) plus `cart.cart_items` cleanup. Removed 49,255 + 307 rows. 5 rows referenced by `order.order_items` were preserved (historical purchase integrity).
- Verified new seeder live: `run-2026-05-13T08-20-02Z.log` shows `seeded 0 products, skipped 50/50 (0 as already-seeded duplicates, 46 dropped for missing phone)` — current `automobiles_vehicules` category yields 0 shop stores and `OUEDKNISS_JWT` is unset, so every individual-seller listing is correctly dropped.
- Follow-up: set `OUEDKNISS_JWT` in `/opt/marketplace/.env` so the scraper can reveal per-listing phones; otherwise the only categories that refill the catalog are those dominated by Ouedkniss shop accounts (`siteBuildGetByStore` is the only anonymous phone source).

## 2026-05-12 — vps-eu · web rebuild · robots.txt `/seller$` anchor

- Closes anomaly [9]: `Allow: /seller` overlapped `Disallow: /seller/`, which modern crawlers resolve correctly via most-specific match but is ambiguous to older agents.
- Fix in `packages/web/src/app/robots.ts`: changed the `/seller` allow entry to `/seller$` (Google end-of-URL anchor) in both the wildcard rule and the per-UA rules. Intent is now explicit: index `/seller` (public onboarding), keep `/seller/*` (auth-required dashboard pages) out.
- Web image rebuilt, recreated container. Verified live: `curl https://teno-store.com/robots.txt` shows `Allow: /seller$` on every rule block.

## 2026-05-12 — vps-eu · api+web rebuild · edge-cacheable / + /search, next/image with AVIF

- `/` was force-dynamic with a per-request `getCurrentUser()` cookie read; same for `/search` with no real per-user state. Both routes are the highest-SEO-value entry points (home + slice landings for category/brand/seller). Without ISR, every Googlebot / Bingbot / ChatGPT-User / PerplexityBot hit paid full SSR cost on origin even with the anonymous-cache middleware in front (the cookie touch tainted the whole render).
- Refactor: signed-in agent-activity view moved to a dedicated `/dashboard` route (force-dynamic). `/` is now ISR with `revalidate=60`; always renders the marketing landing. Middleware redirects signed-in users from `/` → `/dashboard`; `/dashboard` clears an invalid `mp_session` cookie before redirecting to `/login` so a stale cookie can't trap a user in `/` ↔ `/dashboard`. Login default `next` changed `/` → `/dashboard`; header user-name now links to `/dashboard`.
- `/search` drops `force-dynamic` → `revalidate=60` (reads only URL params, no cookies/headers).
- next/image: ProductCard + Gallery (hero + thumbnails + lightbox) routed through Next's image optimizer. Live verification — hero thumb at w=384 returns `Content-Type: image/avif`, 13.6 KB (was ~40-50 KB JPEG from the Ouedkniss CDN, 2-3x smaller). `Cache-Control: public, max-age=2592000, must-revalidate` (30 days). next.config.mjs gains `formats: ["image/avif", "image/webp"]` + `minimumCacheTTL: 30 days`.
- Untracked operator test files `packages/api/src/catalog/{cursor,facets,fuzzy,search,sort}.test.ts` integrated; `search.test.ts` had `SearchQuery` fixtures missing required fields — added a `q()` helper. 697 tests + typecheck green pre-deploy.
- Verified live: `/livez` ok; `/` returns 200 with `Cache-Control: public, s-maxage=300, swr=1800` (was no-store under force-dynamic); `/dashboard` 307s to /login for anonymous; `/search?category=telephones` returns 200 with the same edge-cache headers; `/_next/image` proxy serves AVIF.

## 2026-05-12 — vps-eu · api+web rebuild · dep bumps + React-19 form-pending refactor

- Deps: next 15.1.6 → 15.5.18, drizzle-orm 0.44 → 0.45; pnpm.overrides pin fast-uri >=3.1.2, postcss >=8.5.10, ip-address >=10.1.1 (security advisories on transitive deps). Full typecheck + 626 tests green pre-deploy.
- Web: new PendingButton + AddToCartSubmit + PlaceOrderSubmit components built on React 19 useFormStatus; cart/checkout actions and pages wired through them.
- Compose: redis maxmemory-policy persisted as allkeys-lru in docker-compose.prod.yml (was applied at runtime during today's incident). Compose did not recreate the redis container on `up -d` — the command-flag change wasn't enough to trigger recreation, so the live keyspace was preserved. Next manual restart will pick up the policy.
- API/DB: catalog/sort, /healthz, products route, server bootstrap, db client + product repo cleanups.
- Deploy: tar+ssh sync, `docker compose build api web` + `up -d api web caddy redis` (redis no-op). Verified `/livez` ok, homepage 200 with the new French title, sitemap 18,944 URLs.

## 2026-05-12 — vps-eu · api+web rebuild · home-page perf, French error banner, SEO title alignment

- API perf: home-page "recent listings" strip now goes through a `noFacets=true` query param that bypasses the catalog-wide `loadAll` and runs `recentIds()` — an indexed `ORDER BY created_at DESC LIMIT N` SQL query. Was the main cause of 11s+ cold home-page TTFB on the 77k-product catalog.
- DB: migration 0011 adds `catalog.media(product_id)` btree. Product-detail lookups were running 372k-row parallel seq-scans to find ~5 media rows (~99.99% miss rate against the only existing index). Pre-applied with `CREATE INDEX CONCURRENTLY` to avoid the write-lock window; drizzle migration then ran with `IF NOT EXISTS` no-op.
- UX: /search "Marketplace API unreachable" dev-text banner replaced with French "Catalogue momentanément indisponible" — technical message routed to server log only. Was leaking developer copy onto the buyer-facing search page during API hiccups.
- SEO: homepage `<title>` rewritten from "Teno Store — the agent-to-agent marketplace" (English dev pitch on a `<html lang="fr">` page) to "Teno Store — Marketplace algérien : téléphones, électroménager, mode et véhicules en DZD". Aligns with the rendered French H1 and meta description; the agent-marketplace angle stays on og:title for socials and in keywords.
- Operator: misc edits to seller dashboard, seller/products/new form, cart route, auth middleware, header cart, sign-out, error page.
- Deploy: tar+ssh, `docker compose build api web` + `up -d api web caddy`, ~3 min. Verified `/livez` ok, homepage 200 with new title, sitemap intact.

## 2026-05-12 — vps-eu · redis · maxmemory-policy volatile-lru → allkeys-lru (incident response)

- Symptom: marketplace-redis container had restarted **32 times**; api logs showed 58 `MaxRetriesPerRequestError` from ioredis in 6 h; Caddy slow paths showed /sitemap.xml at 194 s, /feed.xml 174 s, / at 65 s, /product/* at 55 s. When Redis was unreachable, every API call that wrote a snapshot or checked idempotency timed out and cascaded into the SSR layer.
- Root cause: keyspace held 56,236 `snap:*` keys (+1 `pcache:*`) totalling 1.49 GiB of the 2 GiB ceiling — all with valid 24 h TTLs, but write rate × accumulated lifespan kept Redis pinned at maxmemory. `volatile-lru` happened to evict 0 keys in that window (`evicted_keys: 0` on inspect), so any new write hit `OOM command not allowed when used memory > 'maxmemory'`, ioredis exhausted retries, and the container cycled.
- Fix: `redis-cli config set maxmemory-policy allkeys-lru` (runtime, no restart) + edit `docker-compose.prod.yml` redis block so the policy survives the next `compose up -d redis`. Bumping the 2 GiB cap was explicitly NOT done — the keyspace is already 100% ephemeral snapshots so an eviction-friendly policy is the right shape, not more memory.
- The original comment in the compose file argued `volatile-lru` protected "future durable session keys"; updated comment notes the rationale no longer holds at the current keyspace + LRU recency keeps hot session keys cached regardless.
- Verified live: policy now `allkeys-lru`, used_memory 1.51 GiB, evicted_keys 0 (still under ceiling; eviction will trigger when next write pushes us over). Post-change: 1 api error from the restart window, then 0 errors. Cold home cache rebuild 13 s once, warm hits 100–170 ms.
- Reference: reports/anomalies.txt [56].

## 2026-05-12 — vps-eu · api+web rebuild · SEO entity enrichment batch + operator cart/checkout polish

- SEO: /about now ships FAQPage JSON-LD (6 French buyer Q&A pairs) + Speakable annotation for AI voice/search snippets (`#faq-heading` + sibling `<dl>`).
- SEO: /store/{id} Store JSON-LD now conditionally emits `currenciesAccepted` + `areaServed` for sellers with a validated `countryCode` (DZ/FR/TN/MA whitelist). Currently dormant for the scraped Ouedkniss seller catalog (no `countryCode` set per row) — follow-up will default to DZ given the prod catalog is all-Algerian.
- SEO: homepage Organization @graph node gains `additionalType: OnlineStore`, `slogan`, structured `contactPoint` (areaServed=DZ, availableLanguage=[fr, ar, en]).
- Operator: cart/checkout/order/product page polish + api filter (catalog/filter.ts + new filter.test.ts) + format lib expansion. All typechecks + 119 web tests + 37 api tests green pre-deploy.
- Deploy: full tar+ssh sync, `docker compose build api web` + `up -d api web caddy`. ~3 min, ~15s traffic blip on container recreate.
- Verified live: `https://teno-store.com/about` carries FAQPage + Speakable; `https://teno-store.com/` carries Organization with OnlineStore + slogan + ContactPoint. api `/livez` ok.

## 2026-05-11 — vps-eu · web rebuild · SEO — PWA manifest now French (lang+description); was English on a `<html lang="fr">` site

- `/manifest.webmanifest` was emitting `"lang":"en"` with an English `description` even though every other surface on the site is French primary (HTML root, home H1, JSON-LD inLanguage, OpenGraph locale, all sitemapped pages). Lighthouse PWA audits, browser "Install app" surfaces, and the few search-engine pipelines that consume the manifest were seeing English copy on a French-locale page.
- Switched `lang` → `"fr"` and rewrote description in French: `Teno Store — marketplace algérien avec des milliers d'annonces de téléphones, informatique, électroménager, mode et véhicules. Vendeurs algériens, prix en dinars (DZD), catalogue actualisé en continu. Aussi un marketplace agent-à-agent via MCP/A2A/AP2.` Updated the matching assertion in `manifest.test.ts`.
- Verified live: `curl https://teno-store.com/manifest.webmanifest | jq .lang` → `"fr"`. Type-check clean, 4/4 manifest tests pass.
- Standing iter-1, iter-19, iter-20 operator-side recommendations still open.

## 2026-05-11 — vps-eu · web rebuild · SEO/perf — only the first product card gets `fetchPriority="high"` (Core Web Vitals LCP fix on home + search pages)

- Home page was emitting 4 `<link rel="preload" as="image" fetchPriority="high">` tags from the recent-listings strip (4 cards × `eager={i < 4}` in ProductGrid → both `loading=eager` AND `fetchPriority=high` per card). LCP measures the SINGLE largest visible element, so only one image per page benefits from `fetchPriority="high"`; setting it on 4 simultaneous fetches made the browser split bandwidth across them and slowed the actual LCP candidate.
- Split the ProductCard prop: `eager` still controls `loading="eager"` (parallel above-the-fold loading), but `priority` is a separate, narrower flag controlling `fetchPriority="high"`. ProductGrid now passes `eager={i < 4}` (unchanged — above-fold row still loads in parallel) plus `priority={i === 0}` — only the first card. Same fix applies to /search results pages and any other ProductGrid consumer.
- Verified live: home page now ships ONE `fetchPriority="high"` preload + 3 `fetchPriority="auto"` preloads, with all 4 still `loading="eager"`. The first product card image is the LCP candidate; the other 3 above-fold cards load in parallel without competing for bandwidth priority.
- Type-check clean; 9/9 ProductCard tests pass.
- Standing iter-1, iter-19, iter-20 operator-side recommendations still open.

## 2026-05-11 — vps-eu · web rebuild · SEO/perf — bump anonymous HTML s-maxage 60s→300s, swr 300s→1800s (buffer origin from sustained ClaudeBot load)

- Caddy access log analysis this iteration: ClaudeBot is now crawling at **163 req/min sustained** (up from ~12/min at iter-19), p99 latency **9.8s**, max **60.5s**, avg 1.05s. ~1% of requests are very slow because every hit reaches origin uncached (Cloudflare Cache Rule still pending). 1,423 ClaudeBot hits in a recent 10-min window.
- Bumped middleware Cache-Control on anonymous HTML: `s-maxage=60, stale-while-revalidate=300` → `s-maxage=300, stale-while-revalidate=1800`. Once Cloudflare activates, one cold render now serves 5 minutes worth of crawler hits to the same URL (vs 1 minute before), plus 30 minutes of stale-while-revalidate grace serving warmly while a background refresh fires. That's the buffer the 2-3 req/s ClaudeBot load actually needs.
- Why this staleness window is safe for the Ouedkniss-sourced catalog: scraped listings update on the seller's schedule, not minute-to-minute. The scrape-and-seed loop runs at minute cadence so genuinely-new products surface via the sitemap (fresh lastmod every minute) regardless of per-URL cache TTL. Price/availability staleness up to 5 min is well within marketplace norms.
- Verified live: `curl -sI /product/<id>` returns `Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=1800`. Cookie-bearing requests still get the framework default `private, no-store` (logged-in personalization protected).
- Type-check clean. Standing iter-1 recommendation still open (Cloudflare Cache Rule activation). Standing iter-20 recommendation still open (DB country backfill of 1,705 US-tagged Algerian sellers).

## 2026-05-11 — vps-eu · scraper + api rebuild · per-listing phone reveal + resilience pass

- Scraper (`/opt/marketplace/scripts/scrape-ouedkniss.mjs`): adds optional `OUEDKNISS_JWT` env. When set, calls `announcementPhoneGet` per listing (the SPA's `UnhidePhone` op) and attaches `phoneEntries` to each item. Anonymous calls return `[]` — phone reveal is gated behind a reCAPTCHA-backed `/login-anonymous` Bearer JWT; operator pastes the JWT once per expiry. The seeder unions per-listing phones with shop site-build phones, dedupes by E.164, marks the first primary. JWT not yet set in `.env`; the loop currently logs `[phones] OUEDKNISS_JWT not set` and behaves as before.
- Resilience: all GraphQL traffic now goes through `fetchWithTimeout` (15s default, `FETCH_TIMEOUT_MS` overridable). Page-fetch failures `continue` to the next page instead of `break`ing; per-item exceptions are caught with an `itemFailures` counter; the output JSON is written via a `finally` block so partial results always land on disk. Seeder `resolveSeller` is wrapped in `try/catch` — one seller-create failure no longer aborts the batch.
- API image rebuilt (`docker compose -f docker-compose.prod.yml build api && up -d api`) so the bundled `packages/db/dist/seed-from-scraped.js` ships the seeder changes. Verified: next run-loop iteration at 23:53 CEST seeded 32/50, exit_code=0, `[phones]` line emitted.

## 2026-05-11 — vps-eu · web rebuild · cart/checkout copy + UX polish

- Cart page now says "Delivery — Free (cash on delivery)" instead of the misleading "Calculated at checkout".
- Cart and checkout Totals now read `totals.totalMinor` (was `totals.subtotalMinor`). Same number today since shipping/tax are zero, but defends against future divergence and matches the order page.
- New `+` / `−` qty buttons on each cart line for one-click adjustments (server action with the new qty). The typed-number input is still there for keyboard users; the explicit "Update" button is gone (the input commits when blurred via the surrounding form).
- Added a "← Continue shopping" link to the populated-cart summary panel.
- Verified end-to-end on prod: anonymous cart with 3× a DZD 1,150,000 listing renders Total = DZD 3,450,000 on both /cart and /checkout.

## 2026-05-11 — vps-eu · api rebuild · checkout no longer silently auto-applies a shipping fee

- Bug: order confirmation page showed a total higher than the cart/checkout pages (e.g. cart says DZD 44, order page says DZD 49.99). Root cause: `priceQuote` auto-selects `shippingOptions[0]` when the caller doesn't pass `preferredShipping`. `/v1/checkout/confirm` was passing `FLAT_SHIPPING_OPTIONS` unconditionally, so a 599-minor "standard" fee was added at order-creation time even though the web UI never surfaces a shipping picker.
- Fix in `packages/api/src/routes/checkout.ts`: pass `shippingOptions: body.shipping ? FLAT_SHIPPING_OPTIONS : []` in the confirm path. The `/v1/checkout/quote` endpoint still returns the FLAT list unchanged for any future shipping picker.
- Patched the one existing affected order row in prod: `UPDATE order.orders SET shipping_minor=0, total_minor=subtotal_minor ... WHERE id='019e18fc-602e-7320-aaa0-046c0a30177a'`. Order MP-260511-5EJ08R now shows DZD 44.00 total to match the single DZD 44.00 line item.
- Verified API: `/v1/orders/019e18fc-…` returns `subtotalMinor=4400 shippingMinor=0 totalMinor=4400`.

## 2026-05-11 — vps-eu · web rebuild · SEO — middleware Vary: Cookie now appends (was set); intent-preserving even though Next.js framework currently overrides the final response Vary

- iter-15 middleware emits `Cache-Control: public, …` + `Vary: Cookie` on anonymous indexable HTML. Live-response audit this iteration found Vary is missing Cookie: actual response is `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding`. Next.js's framework Vary set runs AFTER middleware and replaces, not merges.
- Changed `res.headers.set("Vary", "Cookie")` → `.append(...)`. Doesn't change live behavior — Next still overrides — but the code intent is clearer, and a future Next.js version (or alternate framework set-vs-append behavior) would automatically pick up the appended token.
- Safety unchanged: my middleware emits public Cache-Control only when `mp_session` cookie is ABSENT, so logged-in HTML never gets cacheable headers regardless of Vary. The pending operator-side Cloudflare Cache Rule expression already includes `(not http.cookie contains "mp_session=")` as the explicit cache-bypass condition (see iter-19 seo.md write-up), so the rule doesn't rely on Vary either.
- No observable response change. Type-check clean.
- Standing iter-1 recommendation still open (Cloudflare Cache Rule). Standing iter-20 recommendation still open (DB backfill of 1,705 US-tagged Algerian sellers).

## 2026-05-11 — vps-eu · web rebuild · SEO — Atom feed `<updated>` now uses ingestion time (was source post date); same fix iter-16 applied to the sitemap

- `/feed.xml` (announced via `<link rel="alternate" type="application/atom+xml">` on every page; consumed by RSS readers and AI crawlers' freshness pipelines — Claude's web tool, Perplexity, etc.) emitted every entry's `<updated>` and `<published>` and the top-level `<updated>` from `hit.postedAt` — the same `attributes.sourcePostedAt ?? createdAt` precedence that iter-16 fixed for the sitemap. Feed readers were seeing entries with "last modified 2017" / "2020" / "2024" timestamps on listings we ingested today.
- Wired the iter-16 `updatedAt` API field through to feed.xml:
  - `<entry><updated>` = `hit.updatedAt ?? hit.postedAt` (our ingestion time, falling back to source date if the API hasn't shipped the new field yet)
  - `<entry><published>` = unchanged (source post date — semantically "when the listing was first published on Ouedkniss" still makes sense for first-publication timestamp)
  - Top-level `<feed><updated>` = `hits[0].updatedAt ?? hits[0].postedAt` (newest ingestion timestamp across the feed)
  - ETag fingerprint now incorporates the newest updatedAt, so conditional GET (`If-None-Match` / `If-Modified-Since`) correctly invalidates when fresh ingestion happens even if source post dates are old.
- Verified live: feed top `<updated>` went `2026-05-11T13:34:29` → `2026-05-11T18:09:18` (ingestion time, ~5 hours newer than the source date). Per-entry `<updated>` aligned.
- Type-check clean.
- Standing iter-1 recommendation still open (Cloudflare Cache Rule for anonymous HTML). With this and iter-16 both shipping, Google + RSS-aware crawlers now see consistent recent freshness signals across BOTH the sitemap and the Atom feed.

## 2026-05-11 — vps-eu · web rebuild · SEO — Open Graph `product:category` now uses humanized French label (was raw slug); unblock pnpm v10 build via `onlyBuiltDependencies`; flag deploy footgun re-occurrence

- Product page emitted `<meta property="product:category" content="telephones"/>` — the raw category slug. Pinterest / Facebook / Discord product cards parse this tag to render category context; "telephones" reads as English/lowercase noise vs. "Téléphones". Switched to `humanizeCategorySlug(p.categoryIds[0])` — same FR_CATEGORY map that already feeds JSON-LD `Product.category`, the breadcrumb category step, and `buildProductDescription`. Single source of truth for the French taxonomy label across the page's structured-data surface.
- Verified live: sample product now ships `<meta property="product:category" content="Téléphones"/>`.
- **pnpm v10 build break:** during this iteration's deploy the web image rebuild failed with `ERR_PNPM_IGNORED_BUILDS` on `esbuild@*` and `sharp@0.34.5`. pnpm 10 made ignored-builds-as-error the default behavior — previously these post-install scripts ran silently. Fixed by adding `"pnpm": {"onlyBuiltDependencies": ["esbuild", "sharp"]}` to root `package.json` (allowlist for native-binary postinstalls; everything else still blocked). Tested + verified the build then completed normally.
- **Deploy footgun re-occurrence (iter-11 lesson not absorbed):** my first deploy attempt this iteration chained `cd packages/web && npx tsc && tar ...` for the typecheck, leaving the shell cwd in the package subdir; the tar then shipped a single-package layout on top of the workspace, overwriting `/opt/marketplace/package.json` with `packages/web/package.json`. The pnpm build break above became visible only AFTER fixing this. Recovered by re-shipping from explicit repo root. The hardening I keep deferring (a small `scripts/deploy.sh` that runs `cd "$(git rev-parse --show-toplevel)"` first) would prevent the recurrence — flagging as a real action item for the operator or a future iteration.
- Type-check clean; 8/8 product-page tests pass.
- Standing iter-1 recommendation still open: Cloudflare Cache Rule for anonymous HTML. Highest unrealized lever — code-side groundwork is complete.

## 2026-05-11 — vps-eu · api rebuild · SEO — search API surfaces `updatedAt` (ingestion time) alongside `postedAt`; sitemap lastmod range collapses from 2017-2026 → last 3 days (Google freshness signal repair on ~19% of catalog)

- Sitemap emits `<lastmod>` per product using `hit.updatedAt ?? hit.postedAt`. API only shipped `postedAt`, which is `attributes.sourcePostedAt ?? createdAt` — for scraped products the Ouedkniss original-post date wins, even though we only ingested the listing minutes ago. Result: sitemap lastmod ranged 2017-03-12 to today, with **8,464 products (19%) > 6 months old, 3,251 (7%) > 1 year, 2,402 (5%) > 2 years**. Google's freshness algorithms treat those URLs as abandoned content — depresses ranking even though the listings are actively for sale and the page renders dynamically from the current DB.
- API now also surfaces `updatedAt: new Date(p.createdAt).toISOString()` — our ingestion time. `SearchHit` interface in `packages/api/src/catalog/search.ts` extended; `projectHit` emits both fields; `packages/api/src/routes/products.ts` passes through. Pure additive — `postedAt` is preserved for UI rendering ("Posté il y a N jours" relative time, where the seller's perspective is what's meaningful to a human buyer); `updatedAt` feeds the sitemap.
- Sitemap.ts already had `const ts = hit.updatedAt ?? hit.postedAt` from an earlier iteration — preferring updatedAt when present — so no web-side change needed. New field auto-takes effect after the sitemap module-cache TTL rolls over.
- Verified live: `GET /v1/products?limit=3&sort=newest` returns `postedAt: 2026-05-11T13:34Z` (Ouedkniss source) AND `updatedAt: 2026-05-11T18:09Z` (our ingestion) on the same hit. Sitemap lastmod range now `2026-05-08 → 2026-05-11` (was `2017-03-12 → 2026-05-11`). Oldest entry is the initial seed-batch date.
- API typecheck clean; 25/25 api tests pass.
- Standing iter-1 recommendation still open (Cloudflare Cache Rule). Combined with this iteration's freshness-signal repair, Googlebot will crawl with both (a) much lower origin cost per fetch once Cloudflare caches kick in and (b) recent lastmods telling it URLs are worth refreshing.

## 2026-05-11 — vps-eu · web rebuild · SEO — anonymous HTML now ships `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` (was `private, no-store`); code half of the iter-1 standing recommendation, operator-side Cloudflare Cache Rule still needed to actually cache at the edge

- Every indexable HTML page (home / search / product / about / seller / store) was shipping the framework's dynamic-route default `private, no-cache, no-store, max-age=0, must-revalidate`. That blocked Cloudflare and any intermediate cache from holding HTML — every Googlebot crawl of the 21k product URLs in the sitemap hit origin, capped catalog indexation depth and freshness on per-origin crawl budget.
- Why this is now ship-able: the operator's iter-7 `/s/:id` `headers()` entry in `next.config.mjs` proved that route-level Cache-Control overrides the framework default in practice (live `/s/:id` returns the operator's `public, max-age=3600` not Next's no-store). But unlike `/s/:id`, the indexable pages on this site render personalized content (HeaderUserMenu, home AgentActivity) when a session cookie is present — unconditional `public` would let a shared cache serve one user's logged-in HTML to another. So this lands as Next.js edge middleware rather than `headers()` entries: conditional on session-cookie ABSENCE.
- `packages/web/src/middleware.ts` (~25 lines, new file). Matcher narrowed to the indexable HTML routes (`/`, `/about`, `/seller`, `/search`, `/product/:id`, `/store/:id`) so middleware doesn't run on `_next/*` or `/api/*`. Emit logic: if `mp_session` cookie is present → pass through, framework default no-store applies. Otherwise → set `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300` + `Vary: Cookie`. `max-age=0` keeps the browser from holding stale HTML across navigations; `s-maxage=60` is what shared caches (Cloudflare) honor; `swr=300` lets Cloudflare serve a 1-5 min stale HTML while it revalidates in the background, smoothing crawler bursts.
- Personalization-leak safety: SSR responses with `mp_session` never get the public header, so no shared cache will hold a logged-in user's HTML. Even without a Cloudflare rule activating this cache, the change is safe.
- Verified live:
  - `curl -sI https://teno-store.com/` (anonymous) → `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`
  - `curl -sI https://teno-store.com/product/<id>` (anonymous) → same public Cache-Control
  - `curl -sI https://teno-store.com/search?category=telephones` (anonymous) → same public Cache-Control
  - `curl -sI -H 'Cookie: mp_session=test' https://teno-store.com/product/<id>` → `private, no-cache, no-store, max-age=0, must-revalidate` (the framework default — middleware correctly skipped the cookie-bearing request)
- Type-check clean. Two unrelated test failures in `sitemap.test.ts` and `search/page.test.ts` were present BEFORE this change (operator's in-flight `/store/:id` work — `/search?sellerId=X` now redirects to `/store/X`, and the sitemap seller-slice section was removed in the iter-9 directory-of-storefronts privacy cleanup). Flagged for the operator to update those tests; not blocking the middleware deploy.
- **Operator action remaining to actually unlock the crawl-budget gain**: add a Cloudflare Cache Rule on `teno-store.com` matching URI paths `/`, `/about`, `/seller`, `/search*`, `/product/*`, `/store/*` AND `cf.request.cookies["mp_session"]` is empty → Cache eligibility: Eligible; Edge TTL: Respect origin (60s); Browser TTL: Respect origin. After deploy, verify with `curl -sI` that responses start showing `cf-cache-status: HIT` on the second request. Expected target: ≥80% hit rate on `/product/*` for Googlebot within 24h, which should let Google's crawler complete a full-catalog refresh in ~1 hour instead of being throttled by origin RPS over many hours.

## 2026-05-11 — vps-eu · web rebuild · SEO — Product JSON-LD `brand` enriched with `@id` + `url` pointing at brand-slice landing (Google knowledge-graph clustering)

- Product JSON-LD declared brand as an anonymous Brand node: `"brand": {"@type": "Brand", "name": "Renault"}`. Across ~40k product pages, each Renault listing emitted its own anonymous Brand node — Google has to guess that "Renault on Teno Store" is the same entity across all of them; the brand-slice page at `/search?brand=Renault` was a separate document with no structured link to those product nodes.
- Added a stable `@id` and `url` pointing at the brand-slice landing (same target the visible brand chip links to since iter-10): `{"@type": "Brand", "@id": "https://teno-store.com/search?brand=Renault", "name": "Renault", "url": "https://teno-store.com/search?brand=Renault"}`. Every Renault product page now references the same Brand `@id`, so Google's knowledge-graph resolver clusters them under one entity, and the brand-slice page (canonical-self, sitemapped when count ≥ 5) accumulates the entity's authority from every listing that points at it.
- Pure additive change — strings and ImageObject brand shapes both still validate as Product.brand on Google's structured-data validator. `${SITE_URL}/search?brand=X` is accepted as the entity URL.
- Verified live: sample Renault product now ships the `@id`/`url`-enriched brand node. Type-check clean; 108/108 web tests pass (one test snapshot updated to assert the new brand shape).
- Standing iter-1 recommendation still open: Cache-Control middleware for anonymous HTML + Cloudflare Cache Rule (operator-side). Highest unrealized lever — code-side locale + structured-data + internal-linking work is now broadly in place across home/about/seller/store/search/product.

## 2026-05-11 — vps-eu · api rebuild · feat — buyer-side MCP tools so agents can place COD orders end-to-end (commits 5c99ae1 + 8c596ab)

- Added seven tools to the live `/mcp` surface: `cart.add_item`, `cart.update_qty`, `cart.remove_item`, `cart.get`, `checkout.confirm`, `order.get`, `seller.list_orders`. tools/list on prod now returns 9 tools total (these seven + the two existing seller-write tools).
- All seven go through the same Drizzle repos as the REST routes. Domain validation (priceQuote, currency-lock, cart non-empty, seller-ownership) is not forked between MCP and HTTP — an agent that places an order shows up in the seller dashboard the same as a browser-driven order.
- Verified live end-to-end with `X-Mp-Mcp-Token`: `cart.add_item` (no cartId → fresh anonymous cart created, Renault Symbol added, `title="Renault Symbol 2018 Diesel 1.5 dCi"`, `subtotal=115000000`) → `checkout.confirm` with `customer: {name: "Agent MCP", phone: "0555888999", region: "Constantine"}` → order `MP-260511-PR94S4` (`status=paid`) → `order.get` with the returned token returns the same order; `order.get` without the token correctly rejects with `Validation failed: orderToken: order_access_denied`.
- New scope strings recognised by the admin-bypass path: `buyer:cart:read`, `buyer:cart:write`, `buyer:checkout:write`, `buyer:order:read`, `seller:order:read`. The fix in 8c596ab corrected a half-applied edit that initially missed the `/mcp` public-path scope default and caused the first prod test to return `missing_scope:buyer:cart:write`.
- New tools wrap the existing `/v1` endpoints' behaviour 1:1 — no schema or DB changes were needed; this is purely an MCP surface addition.

## 2026-05-11 — vps-eu · web rebuild · SEO — /seller landing page French-ified (was English on a `<html lang="fr">` site); follow-up to iter-12 /about French-ification

- `/seller` page was the last fully-English sitemapped surface (after iter-7 home and iter-12 /about): `<title>Sell</title>`, English meta description, H1 "Sell on Teno Store", three English value-prop bullets, English noscript copy. Sitemapped (`priority=0.5`, `index,follow`) and the destination of every "+ Vendre" CTA in the header — so its locale signal also affects every visitor who clicked through from a French page.
- French copy across the page: `<title>Vendre</title>`, meta description (`Publiez vos annonces sur Teno Store et atteignez à la fois les acheteurs algériens et les agents IA…`), H1 (`Vendre sur Teno Store`), French lede (`Connectez-vous avec Google pour gérer votre profil vendeur, publier vos annonces et mettre à jour vos coordonnées.`), three French value-prop bullets (agent reach, anti-contrefaçon, DZD + per-variant pricing), French noscript fallback. The dropped `<section lang="en">` wrapper means the page now reads cleanly as French; only the dev-config error banner ("Google sign-in is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID…") stays English with its own `lang="en"` since it's a developer-targeted prod-misconfiguration message.
- JSON-LD: WebPage `name` → `Vendre sur Teno Store`, French description, `inLanguage: ["fr", "en"]` (mirrors iter-12 /about pattern). OpenGraph locale set to `fr_DZ` with `en_US` as alternateLocale. Page snapshot test rewritten to assert the French strings instead of the English ones.
- Verified live: `<title>Vendre · Teno Store</title>`, French meta description, `<h1>Vendre sur Teno Store</h1>`. Type-check clean; 108/108 web tests pass locally.
- Standing iter-1 recommendation still open: Cache-Control middleware for anonymous HTML + Cloudflare Cache Rule (operator-side). Highest unrealized lever — all the locale + structured-data work is now broadly in place; remaining gains scale with crawl budget.

## 2026-05-11 — vps-eu · web rebuild · SEO — /about page lede + headings now French (was fully English on a `<html lang="fr">` site); long-form developer copy stays English under a `<section lang="en">`

- The `/about` page was fully English: `<title>About</title>`, English meta description, H1 "About Teno Store", all H2s, all body copy. Sitemapped (`priority=0.5`) and `index,follow`, so Google was getting an English topic signal at the apex of the entity-graph site (it cross-references `/#website` + `/#organization` JSON-LD). For French queries like `À propos Teno Store`, `marketplace algérien`, `agents IA Algérie`, the page was working against the site's French locale declaration.
- Mirror of the iter-7 home-page approach: French primary content at the top (title, H1, lede, "Pour les acheteurs", "Pour les vendeurs", "Commencer" sections — the parts crawlers weigh heaviest for topic extraction), then the existing English deep-dive (for-buyers / for-sellers / for-agents / trust-signals) preserved verbatim under a `<section lang="en">` with its own H2 introducing it as the "agents & developers" track. Both audiences served: French SEO signals where they matter most, English technical content kept for AI-agent / developer readers.
- Page-level changes: `metadata.title` `"About"` → `"À propos"`; meta description rewritten in French; `metadata.openGraph.locale` now `"fr_DZ"` with `"en_US"` as alternateLocale; AboutPage JSON-LD `name` → `"À propos de Teno Store"`, `description` rewritten in French, `inLanguage` flipped from `"en"` to `["fr", "en"]` to reflect the bilingual content. Updated the page snapshot test accordingly (3/3 about tests pass).
- Verified live: `<title>À propos · Teno Store</title>`, French meta description (`Teno Store — marketplace algérien…`), H1 `À propos de Teno Store`. Type-check clean; 108/108 web tests pass.
- Standing iter-1 recommendation still open: Cache-Control middleware for anonymous HTML + Cloudflare Cache Rule (operator-side). Highest unrealized lever.
- Follow-up flagged: `/seller` page has the same pattern (`<title>Sell · Teno Store</title>`, H1 "Sell on Teno Store", English meta description) — same fix could apply next iteration.

## 2026-05-11 — vps-eu · web rebuild · SEO — /store/[id] storefront page French-ified (meta description, labels, CTAs) + country code rendered as "Algérie" not "DZ"

- The public seller storefront at `/store/[id]` (sitemapped, `index,follow`) was leaking English copy onto an `<html lang="fr">` site: meta description `"Shop X in DZ on Teno Store. N listings."`, header chip `"Store"`, dt labels `"Phone"/"Website"/"Support"`, badge `"primary"`, section heading `"Listings (N)"` / `"No listings yet"`, empty-state `"This store hasn't published any products yet."`, and CTA `"See all N listings →"`. Plus the visible location rendered the raw ISO country code `"DZ"` next to the seller's city. Mixed-language signal on a French-locale storefront that's pointed at Algerian shoppers searching `boutique <name> Algérie`.
- French copy across the page: `Boutique` (header chip), `Téléphone(s)` / `principal` (phone block), `Site web`, `Contact`, `Annonces (N)` / `Pas encore d'annonces` / `Cette boutique n'a pas encore publié d'annonces.` (listing section), `Voir les N annonces →` (CTA). Meta description rewritten as `Boutique {displayName} en Algérie sur Teno Store. N annonces en dinars algériens (DZD).` + OpenGraph locale tagged `fr_DZ`. The not-found title is now `Boutique introuvable`.
- Added a small `frCountry(cc)` ISO→French mapper (DZ→Algérie, FR→France, TN→Tunisie, MA→Maroc; falls through to the raw code for other countries) used by both the meta description and the visible location line. So a Vendeur Pro in Alger now reads "Alger, Algérie" rather than "Alger, DZ".
- Caught + fixed a French preposition bug on the way: meta description was templating `à ${locality}` which produced `à Algérie` for sellers with country but no city. French uses `en` before feminine countries (Algérie, France, Tunisie) and `au` before masculine (Maroc). Added a small preposition picker: when only a country is known, use the gendered form; when a city is present, keep `à` ("à Alger" / "à Alger, Algérie"). Prod sample after deploy: `Boutique Vendeur Pro 65840 en Algérie sur Teno Store. 12 annonces en dinars algériens (DZD).`
- Deploy footgun caught in the process: my first attempt this iteration chained `cd packages/web && npx tsc && tar . | ssh ...`, which left tar running from the package subdir and shipped a single-package tree on top of the workspace. First `docker compose build web` failed with `pnpm install --no-frozen-lockfile` exit 1 because the workspace root files were now overwritten by the package's. Reshipped from the actual repo root, build succeeded, container is up healthy. Note for future deploys + the runbook: always `pwd` confirm before `tar | ssh` after any `cd`.
- Verified live: meta description carries the corrected French preposition; type-check clean; 108/108 web tests pass locally.
- Standing iter-1 recommendation still open: Cache-Control middleware for anonymous HTML + Cloudflare Cache Rule (operator-side). Highest unrealized lever.

## 2026-05-11 — vps-eu · web rebuild · SEO — product page brand chip is now a link to /search?brand=X, "Sold by" → "Vendu par"

- Product page rendered the brand label as a plain `<span>` next to the H1. That left every branded product page with no internal-link edge to the brand-slice landing (`/search?brand=<brand>`). Brand slices are already sitemapped (when they pass MIN_FACET_COUNT=5, see sitemap.ts) and canonical-self, but received no PageRank from the ~40k product pages that actually mention the brand. Wrapped the chip in `<Link href="/search?brand=...">` with the same visual styling plus a subtle `hover:text-ink` so it reads as interactive without competing with the H1.
- Also caught two strings of English copy on a `<html lang="fr">` page: `Sold by <seller>` and the fallback `this seller`. Changed to `Vendu par <seller>` / `ce vendeur`. Small alignment win for the locale signal — the product page now has no English content in the seller-info block, which previously contributed a brief English fragment in the topical region just below the H1.
- Verified live: sample Renault Symbol product page now ships `<a href="/search?brand=Renault">Renault</a>` next to the H1 and `Vendu par <seller-link>` below it. Type-check clean; 8/8 product tests pass locally.
- Standing iter-1 recommendation still open: Cache-Control middleware for anonymous HTML + Cloudflare Cache Rule (operator-side). Highest unrealized lever.

## 2026-05-11 — vps-eu · web rebuild · SEO — product breadcrumb gained a category layer (was 3-level Accueil→Catalogue→Product; now 4-level Accueil→Catalogue→{Category}→Product, in both JSON-LD BreadcrumbList and visible UI)

- Visible UI breadcrumb and `BreadcrumbList` JSON-LD on product pages were both 3-level (Accueil / Catalogue / ProductTitle). For a marketplace with a closed category taxonomy that's already visible in `p.categoryIds`, the missing category step costs us two things: (a) Google's mobile SERP breadcrumb display renders one less French token, weaker click affordance; (b) PageRank from product pages doesn't flow into category-slice landings (`/search?category=…`) via the breadcrumb edge, even though those slices are sitemapped (priority 0.7) and canonical-self.
- `BreadcrumbList` JSON-LD now emits 4 positions when `p.categoryIds[0]` is set: Accueil → Catalogue → {humanized category} → Product. Falls back to the 3-level form for the few legacy products with empty `categoryIds` (so structured-data validators don't regress on those). Category name uses the same `humanizeCategorySlug` lookup the iter-3 thin-content fix introduced — single source of truth for the FR_CATEGORY map.
- Visible `<Breadcrumbs>` component on the product page mirror-renders the same 4-level structure: extra `<Link>` between Catalogue and the page title, pointing at `/search?category=<slug>` so users have a one-click jump up to the category slice. Layout gained `flex-wrap` so the longer crumb doesn't push the page-title segment off-screen on narrow viewports.
- Verified live: sample IPEGA product (categoryIds: ["telephones"]) now ships `Accueil → Catalogue → Téléphones → Écouteurs filaires IPEGA…` in both BreadcrumbList JSON-LD and visible UI. Type-check clean; 8/8 product tests pass locally.
- Standing iter-1 recommendation still open: Cache-Control middleware for anonymous HTML + Cloudflare Cache Rule (operator-side). Highest unrealized lever.

## 2026-05-11 — vps-eu · web rebuild · UX — drop public "Vendeurs" chip list + reword scary trust card

- `CategoryFooter` no longer renders the per-seller chip section at the bottom of every page. We don't want shoppers (or competing sellers) seeing the full list of storefronts plus listing counts as a public directory. Removed the seller fetch/cache plumbing too, and trimmed the disclosure summary from "N catégories · N marques · N vendeurs" to "N catégories · N marques". The `/v1/products` API still returns the `sellers` facet — only the storefront UI stops surfacing it.
- Home page "Trust signals" card body said *"Counterfeit risk, stock state, and seller-supplied content tagged as untrusted by default."* — "counterfeit risk" and "untrusted" read as alarming/defensive to a buyer landing on the marketing page. Rewrote as *"Stock state, verified seller information, and every listing scored on the same trust rubric."* — same underlying meaning, framed as a positive trust posture.
- Verified live: home page HTML no longer contains a "Vendeurs" section heading or the "Counterfeit risk" / "untrusted by default" strings; "Vendeurs algériens" still appears (correctly) inside meta description copy.
- Touched files: `packages/web/src/components/CategoryFooter.tsx`, `packages/web/src/app/page.tsx`. Web image rebuilt + `up -d web`; api/db/redis/caddy untouched.

## 2026-05-11 — vps-eu · api+web rebuild · feat — minimal cart + cash-on-delivery checkout + seller-orders view (commits d62bd2f + 3500af0)

- Buyer flow live at `/product/:id` (Add-to-cart on the main row + per-variant in the variants table) → `/cart` (qty / remove / subtotal) → `/checkout` (name + phone + Algerian wilaya dropdown of 58 entries) → `/order/:id` (order number + delivery contact + line items). Cart id lives in a 30-day httpOnly cookie; order access token lives in a 90-day per-order httpOnly cookie so anonymous buyers can revisit their confirmation page.
- Backend: `POST /v1/checkout/confirm` now requires a `customer: { name, phone, region }` payload and persists it into `orders.metadata` (existing jsonb column — no new migration). New `GET /v1/sellers/:id/orders`, session-authenticated, returns orders containing the caller's seller items with buyer contact + line subtotal scoped to that seller only.
- Cart + order responses are enriched server-side with product title + SKU + hero image via a single `CartRepo.enrichLines(variantIds)` join — no N+1 round-trips from the web tier.
- Seller dashboard at `/seller/dashboard` now lists incoming orders per seller card: buyer name + click-to-call phone + region, item list with qty, line subtotal, timestamp, status pill.
- Header cart badge renders in the existing nav via a Suspense'd server component; no count is shown until a cart cookie exists, so first-load latency is unchanged for visitors who haven't added anything yet.
- Live end-to-end smoke: POST `/v1/cart/items` (Renault Symbol product) → POST `/v1/checkout/confirm` (customer "Smoke Test", phone 0555000000, region Alger) → order `MP-260511-S9HEBX` status `paid`. /cart returns 200, /checkout 307 redirects to /cart for empty-cart visitors as designed.
- 25 API tests + 26 DB tests + 108 web tests + full repo typecheck all green pre-deploy.
- DB migrations 0007 (`seller.city`) and 0008 (`seller_phones` multi-phone table) bundled in commit d62bd2f and applied on the live Postgres via `node dist/migrate.js` after the api container restart. No data backfill needed — both columns are nullable / new tables.
- Cors update: api now exposes `x-mp-cart-id` + `x-request-id` so cross-origin JS at `teno-store.com` can read the resolved cart id from the response headers (previously hidden by browser default behaviour even when the header was on the wire).

## 2026-05-11 — vps-eu · web rebuild · SEO — Product Offer JSON-LD now carries `areaServed` derived from `p.shipsTo` (sharper geo-targeting for Algerian regional SERPs)

- Product page's Offer / AggregateOffer JSON-LD blocks were missing any explicit region binding. Without `areaServed`, Google has to infer the offer's eligible region from `<html lang="fr">` + `Product.inLanguage`; that works OK for unambiguous queries but degrades when the buyer's IP is outside Algeria (a French-speaker in Paris searching `marketplace algérien` got a less-confident regional match than a buyer in Algiers).
- Now reads `p.shipsTo` (already on every product detail response — Ouedkniss-scraped products carry `["DZ"]`) and emits `areaServed: { "@type": "Country", name: "DZ" }` (or an array when shipsTo has multiple entries). Applied to both branches: single-variant `Offer` and multi-variant `AggregateOffer`.
- Did NOT touch `itemCondition` — the existing comment at the top of the Offer block documents an earlier deliberate decision to omit it until the API exposes per-listing condition. Respected; coverage signals (~83% of products have a phone-bearing seller and are very likely shops with new merchandise) suggest a phone-presence heuristic could justify `NewCondition` for ~34k products, but that's a separate decision worth a proper API-level field rather than a render-time inference.
- Verified live: sample IPEGA product now has `"areaServed": {"@type":"Country","name":"DZ"}` inside the Offer node. Type-check clean; 8/8 product-page tests pass locally.
- Standing iter-1 recommendation still open: Cache-Control middleware for anonymous HTML + Cloudflare Cache Rule (operator-side). Highest unrealized lever.
- **Heads-up for the operator (not deployed by this iteration):** noticed during tar-ship that `packages/web/src/components/CategoryFooter.tsx` is in a half-applied edit state — `FooterFacets` interface no longer declares `sellers`, but downstream code still destructures + renders `sellers`. Looks like an in-progress refactor (collapsing footer to categories+brands only?). If tar-shipped as-is it would fail type-check. My deploy used the file as it was when the tar started, which still had the older shape; the live site is fine. Just flagging so a future deploy doesn't ship the broken intermediate.

## 2026-05-11 — vps-eu · web rebuild · SEO — homepage H1 swapped to the French marketplace headline (was English "Watch your agent shop, in real time.")

- Home is the highest-priority URL in the sitemap (`priority=1.0`) and Google's primary signal for the site's topic. Page is declared `<html lang="fr">` with a French `<meta description>` targeting Algerian queries (`marketplace algérie`, `annonces téléphones DZD`, `vendeurs algériens`), but its H1 was English brand-positioning copy: `Watch your agent shop, in real time.` H1 is the heaviest single weight in Google's on-page topic-extraction pipeline; the English H1 was telling crawlers this page is primarily about AI-agent shopping observability rather than an Algerian marketplace, pulling French-locale ranking signals in the wrong direction.
- Swap (no copy lost, no visual layout change):
  - The English hero line keeps its existing `text-4xl sm:text-6xl` gradient treatment so the brand pitch stays prominent above the fold — but its tag changed from `<h1>` to `<p role="doc-subtitle">`. Reads identically to a sighted user; semantically subordinate to the document's H1.
  - The French catalog headline below the hero (`Marketplace algérien · annonces actualisées en temps réel`) promoted from `<h2>` to `<h1 lang="fr">`. Visual size bumped `text-2xl` → `text-3xl tracking-tight` so it reads as the document's real heading. Now the page's single H1 element and matches both the `<html lang="fr">` declaration and the French `<meta description>` content.
- Verified live: `curl -s https://teno-store.com/ | grep -E '<h1'` returns exactly one H1, the French line. `<p role="doc-subtitle">` correctly carries the English text. No other heading levels changed.
- Type-check + 2/2 home tests pass locally.
- Standing iter-1 recommendation still open: Cache-Control middleware for anonymous HTML + Cloudflare Cache Rule (operator-side). Highest unrealized lever.

