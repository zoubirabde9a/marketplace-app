# SEO — current state and what's left

Snapshot of teno-store.com's discoverability posture and the work needed to actually rank for relevant searches. Last refreshed 2026-05-11 evening (Algiers time) after a long run of iter-1..18 code-side changes; see `deploy/CHANGELOG.md` for every individual deploy in that window.

## Live crawler traffic (last 60 min, per Caddy access log)

| Crawler | Requests | Notes |
|---|---:|---|
| **ClaudeBot** (Anthropic) | **753** | Heavy active crawl of `/product/*` and `/store/*` pages; the AI-discovery push (robots.txt allow-list, `llms.txt`, `agents.json`, French locale signals) is paying off. |
| Bingbot | 1 (lifetime) | One probe to `/store/casaphone?lang=en` → 404 (we have `/store/<uuid>`, not slug). |
| Googlebot | 2 (lifetime) | Both hits are to `/robots.txt` only — Google has discovered we exist but is NOT crawling any pages. This matches the seo.md note that `site:teno-store.com` returns 1 result. |
| Yandex / Seznam / Naver | 0 | IndexNow is feeding them but no direct crawl visible yet. |
| Real users + monitors | ~50 | UptimeRobot + curl probes + a handful of mobile/desktop UAs. |

**Bottleneck restated with fresh data: Googlebot is not crawling.** It's not a technical-SEO issue; it's discovery. All the code-side work below is the foundation that converts crawl visits into rankings — but Google has to start crawling first.

## Foundation in place (verified 2026-05-11)

### Discovery surfaces
- **`/robots.txt`** — explicit AI-crawler allow-list (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, Google-Extended, PerplexityBot, Perplexity-User, Meta-ExternalAgent, CCBot). Cache-Control: `public, max-age=3600, s-maxage=3600, swr=86400`. `Disallow: /api/`, `/login`, `/seller/`, `/s/`.
- **`/sitemap.xml`** — 43,990 URLs (43,886 product URLs + categories/brands/sellers/static). Cache-Control: `public, max-age=300, s-maxage=300, swr=1800`. Lastmod values now reflect ingestion time, not Ouedkniss source date (iter-16 — 19% of products previously had >6mo lastmods, now all in the last 3 days).
- **`/feed.xml`** Atom feed — 50 latest entries, `xml:lang="fr"`, image enclosures at /1200/ CDN. `<updated>` per-entry uses ingestion time (iter-18); `<published>` preserves source date.
- **`/llms.txt`** — plain-text catalog summary for LLM crawlers.
- **`/.well-known/agents.json`** — MCP / A2A / REST / AP2 endpoint discovery.
- **IndexNow** wired into the scrape-and-seed loop (`scraper/run-loop.sh` line 485+) — every batch of newly-seeded URLs gets pushed to Bing/Yandex/Seznam/Naver in real time. No manual re-submission needed.

### Per-page SEO signals (every indexable page)
- `<title>` + `<meta name="description">` rendered server-side (Next.js 15 metadata API).
- `<link rel="canonical">` absolute, no trailing slash. Tracking-param-stripping at the canonical layer (iter-3 of an earlier session) so utm_*/fbclid/gclid don't collapse into the bare URL.
- `<meta name="robots" content="index, follow">` on all indexable; `noindex, follow` on thin facet slices (count < 5).
- `<link rel="alternate" type="application/atom+xml" href="/feed.xml">` for feed discovery.
- `<link rel="alternate" type="application/json" href="/v1/products/<id>">` on product pages — points agent crawlers to the REST twin.
- Open Graph: `og:locale=fr_DZ`, `og:type=product` on product pages, full price+brand+availability product-extension fields, image at /1200/ resolution.
- Twitter Cards: `summary_large_image`.

### Per-locale (French primary, English secondary for dev audience)
- `<html lang="fr">` declared at layout level.
- Home page H1 is French (`Marketplace algérien · annonces actualisées en temps réel`) since iter-7; English brand pitch (`Watch your agent shop, in real time.`) demoted to `<p role="doc-subtitle">` with identical visual treatment.
- `/about` and `/seller` pages: French primary copy (title, H1, lede), with English developer deep-dive preserved under `<section lang="en">` (iter-12 + iter-13).
- `/store/[id]` storefront: fully French — meta description, header chip, dt labels, CTAs, country names ("Alger, Algérie" not "Alger, DZ"); French preposition picker (`en Algérie` / `au Maroc`) for grammatically-correct meta descriptions (iter-11).
- Product page meta description + JSON-LD `Product.description` strip leading Arabic boilerplate ("التوصيل متوفر لجميع الولايات…") so a French-locale page doesn't lead its SERP snippet with Arabic (iter-5; affected ~31% of long-description products).
- Thin-content products (~26%, descriptions < 40 chars) get a humanized French category label injected into the meta description template (iter-3) — dilutes near-duplicate boilerplate across same-brand listings.

### Structured data graph
- Home page: `WebSite` (with `SearchAction` for sitelinks search box) + `Organization` (with `address.addressCountry`, `areaServed: Algeria`, `currenciesAccepted: DZD`); both nodes share `inLanguage: ["fr", "ar", "en"]` and cross-reference via `@graph`.
- Product page: `Product` (with `@id`, name, description, image[], category, sku, brand, offers, inLanguage) + `BreadcrumbList` (4-level since iter-9: Accueil → Catalogue → {French category} → Product). `Offer` carries price/currency/availability/priceValidUntil/areaServed/seller. `Brand` is now a clusterable entity with `@id` + `url` pointing at the brand-slice landing (iter-14).
- `/about`: `AboutPage` cross-referencing `/#website` + `/#organization`; `inLanguage: ["fr", "en"]`.
- `/seller`: `WebPage` cross-referencing same anchors; `inLanguage: ["fr", "en"]`.
- `/store/[id]`: `Store` with address, telephone, sameAs, description.
- Search slice landings: `CollectionPage` + `ItemList` with French names (iter-3 of an earlier session).
- `priceValidUntil` set to +1 year (Google Merchant requires it; no real expiry on listings).
- `itemCondition` intentionally omitted (deliberate per code comment at `product/[id]/page.tsx:337-344` — Ouedkniss inventory is a mix of new/used/refurbished and the API doesn't expose per-listing condition).

### Caching + freshness
- **iter-15 Cache-Control middleware** (`packages/web/src/middleware.ts`): anonymous HTML requests on indexable routes (`/`, `/about`, `/seller`, `/search`, `/product/:id`, `/store/:id`) get `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300` + `Vary: Cookie`. Cookie-bearing (logged-in) requests keep the framework default `private, no-cache, no-store` — no personalization leak risk.
- **Static files** (`robots.txt`, `llms.txt`, `manifest.webmanifest`, IndexNow key file, well-known files): public + 1h max-age + 24h swr via `next.config.mjs` headers().
- **`/sitemap.xml`** + **`/s/:id`**: public, longer TTLs as documented in `next.config.mjs`.

### Internal linking
- Product page brand chip → `/search?brand=X` (iter-10).
- Product page breadcrumb category step → `/search?category=X` (iter-9).
- Product page "Vendu par" → seller storefront (iter-10).
- Header "+ Vendre" CTA → `/seller/products/new` from every page (iter-1 of layout work).
- Top-of-page collapsible `<details>` with category + brand chips (iter-1 of layout work) — replaced the bottom CategoryFooter that was unreachable under infinite scroll.

### Infrastructure
- HSTS, X-Content-Type-Options, X-Frame-Options, Permissions-Policy set by Caddy.
- HTTP/3 advertised (`alt-svc: h3=":443"`).
- API at `api.teno-store.com` returns `noindex` robots and matching disallow on its own `/robots.txt`.

## What's left — operator actions (in priority order)

1. **[CRITICAL] Submit sitemap to Google Search Console.** Every code-side iteration since 2026-05-10 has been polishing pages Google isn't crawling. This is THE remaining unblocked lever for getting any product into the index.
   - `https://search.google.com/search-console` → add `teno-store.com` (Domain type) → verify via DNS TXT in Cloudflare → Sitemaps → submit `https://teno-store.com/sitemap.xml`.
   - URL Inspection → "Request indexing" on `https://teno-store.com/` (forces apex recrawl, replaces the stale Arabic snippet from the prior domain owner within ~24h) and on 3-5 sample product URLs.
2. **[HIGH] Add a Cloudflare Cache Rule for anonymous HTML.** Code-side middleware (iter-15) is emitting the right headers; Cloudflare just isn't acting on them. Without this, every Googlebot/ClaudeBot fetch hits origin — caddy logs show some responses taking 2-8 seconds, which throttles crawl rate.
   - Cloudflare dashboard → Caching → Cache Rules → New: match `(http.host eq "teno-store.com") and (starts_with(http.request.uri.path, "/product/") or starts_with(http.request.uri.path, "/search") or starts_with(http.request.uri.path, "/store/") or http.request.uri.path in {"/" "/about" "/seller"}) and (not http.cookie contains "mp_session=")` → Cache eligibility: Eligible; Edge TTL: Respect origin (60s); Browser TTL: Respect origin.
   - After deploy, verify with `curl -sI` that `cf-cache-status: HIT` appears on the second hit.
3. **[MEDIUM] Submit to Bing Webmaster Tools.** Lower priority since IndexNow is feeding Bing daily, but the dashboard surfaces coverage stats IndexNow doesn't.
4. **[MEDIUM] Run Google Rich Results Test on one product URL.** `https://search.google.com/test/rich-results` — confirms the `Product` + `BreadcrumbList` JSON-LD parses and previews. Note: we're eligible for "Product snippet" enhancement (name + image + offers), NOT "Merchant listing" (would need `itemCondition` + `hasMerchantReturnPolicy` + at least one of gtin/mpn/isbn, none of which Ouedkniss exposes per listing).
5. **[LOW] Flip Cloudflare SSL/TLS to Full (strict).** Noted as TODO in `dns.md`.
6. **[LOW] Defensive `tenostore.com` (no hyphen) registration** to redirect to the canonical hyphenated domain. Brand-collision mitigation against TeNo jewelry; not urgent until brand searches start mattering.

## Known concerns (unchanged from earlier seo.md, still applicable)

- **Brand collision with TeNo Jewelry** (teno.com). Mitigations in place: always co-locate "agent" or "marketplace" with branded copy; `Organization` JSON-LD on the home page gives Google an explicit entity for *this* brand; iter-7 swap put `Marketplace algérien` in the H1.
- **Cloudflare Bot Fight Mode** is on. Re-confirm after Search Console submission that it doesn't block Googlebot. Cloudflare's defaults usually permit verified bots, but worth a one-time check via the "Verified Bots" report.
- **Merchant Listing eligibility ceiling**: without per-listing gtin/mpn data from Ouedkniss, we're eligible for Product snippet rich results but not Merchant Listing. That's the realistic ceiling for this catalog.
