# SEO — current state and what's left

Snapshot of teno-store.com's discoverability posture and the work needed to actually rank for relevant searches.

## Foundation already in place (verified 2026-05-08)

- **`<title>`** and **`<meta name="description">`** rendered server-side on every page (Next.js 15 metadata API, `packages/web/src/app/layout.tsx`).
- **Open Graph + Twitter Cards** populated for the home page and inherited by product pages.
- **Canonical URL** absolute (`https://teno-store.com`), rewritten correctly after the `NEXT_PUBLIC_SITE_URL` build-arg fix.
- **`<link rel="canonical">`**, `robots: index, follow`.
- **JSON-LD** on the home page: `WebSite` with `SearchAction` (qualifies us for Google's sitelinks search box once indexed).
- **JSON-LD** on each `/product/{id}` page: `schema.org/Product` + `AggregateOffer` with brand, seller, availability — qualifies for Google rich-result product cards.
- **`/sitemap.xml`** — auto-generated; pulls product URLs from `/v1/products` at request time.
- **`/robots.txt`** — explicit allow-list for current AI crawlers: `GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `ClaudeBot`, `Claude-SearchBot`, `Claude-User`, `Google-Extended`, `PerplexityBot`, `Perplexity-User`, `Meta-ExternalAgent`, `CCBot`. The deprecated `anthropic-ai` and `Claude-Web` user-agents are intentionally omitted. `Disallow: /api/`, `/login`, `/seller/`, `/s/`.
- **`/llms.txt`** — proposed [llmstxt.org](https://llmstxt.org/) convention; plain-text site summary for LLM crawlers.
- **`/.well-known/agents.json`** — MCP / A2A / REST / AP2 endpoint discovery for AI agents.
- **HSTS, X-Content-Type-Options, X-Frame-Options, Permissions-Policy** — set by Caddy (verified via `curl -I`).
- **HTTP/3** advertised (`alt-svc: h3=":443"`).

## Why Google isn't returning us yet (verified via web search 2026-05-10)

`site:teno-store.com` returns exactly **one** result — the apex — and the cached snippet is in Arabic, almost certainly stale content from a prior owner of the domain ("تينو - أنشئ متجرك الإلكتروني مجانًا"). None of the ~3,200 product URLs are indexed. The bottleneck is no longer the catalog or technical SEO — both are solid. It's:

1. **No Search Console submission.** Google's crawl rate for an unknown domain is 1–2 pages/month organically. Submitting the sitemap and requesting indexing on the apex cuts time-to-first-product-indexed from weeks to days, AND triggers a recrawl that replaces the stale Arabic snippet. **This is gated on the operator's Google login.**
2. **Brand collision with TeNo Jewelry** (teno.com) on the bare term "teno store". Mitigated by always co-locating "agent" or "marketplace" in copy, and by the `Organization` JSON-LD on the home page that gives Google an explicit entity for *this* brand.

For the non-Google search world, IndexNow has been used to push all URLs to Bing/Yandex/Seznam/Naver as of 2026-05-10 — see the action checklist below.

## Known concerns

### Brand collision: TeNo (jewelry)

A web search for "teno-store.com agent marketplace" surfaces **TeNo** ([teno.com](https://www.teno.com/)) — a jewelry retailer with substantial domain authority. Branded searches like "teno store" will likely bury us behind that brand for months unless we differentiate aggressively. Mitigations:
- Always co-locate "agent" or "marketplace" in branded copy (already done).
- Prioritize keyword pages around "agent marketplace", "MCP marketplace", "AP2 marketplace" — terms that don't compete with the jewelry brand.
- Optional: register `tenostore.com` (no hyphen) as a defensive redirect.

### Language mismatch (looming)

- The home page is in **English**, with `lang="en"` and `og:locale=en_US`.
- The Algerian product catalog will be in **French** (titles, descriptions).
- Google indexes per language. A French-language query like *"iPhone 15 Pro Max prix Alger"* will not match an English-locale page even if the body text is French.

Options when the catalog grows beyond a handful of items:
1. **Per-product locale tagging** — emit `<meta property="og:locale" content="fr_DZ">` on `/product/{id}` pages whose content is French. Cheap.
2. **Localized routes** — `/fr/product/{id}` with `hreflang` alternates. Heavier but correct.
3. **Translate home page copy** — addresses the highest-traffic page, doesn't bloat routing.

None of these is urgent until the catalog is non-trivial; flagging now so it's not forgotten.

### Cloudflare Bot Fight Mode

Bot Fight Mode is **on** (per `dns.md`). It blocks low-reputation crawlers. Confirm it does NOT block Googlebot, Bingbot, or the explicitly allow-listed AI bots — Cloudflare's defaults usually permit these, but worth a one-time check via Cloudflare's "Verified Bots" report after Search Console submission goes through.

## Action checklist (in order)

- [x] ~~**Seed the catalog**~~ Done — scrape-and-seed loop is producing real listings; ~3,200 products in the catalog as of 2026-05-10.
- [x] ~~**Push URLs to Bing/Yandex/Seznam/Naver via IndexNow**~~ Done 2026-05-10 — `scripts/indexnow-submit.mjs` submitted all 3,206 sitemap URLs. Re-run after major catalog growth or pass URLs on stdin (`--stdin`) to push only newly seeded products. Host key: `81b0a3ff408a96ef5c0381a78aae7f58` at `https://teno-store.com/81b0a3ff408a96ef5c0381a78aae7f58.txt`.
- [ ] **Submit sitemap to Google Search Console** — `https://search.google.com/search-console` → add property `teno-store.com` (Domain type) → verify via DNS TXT in Cloudflare → Sitemaps → submit `https://teno-store.com/sitemap.xml`. **This is the single biggest unblocked lever right now**: Google has only 1 page indexed (the apex, with stale Arabic snippet from a prior domain owner). Submission triggers a recrawl that fixes the snippet AND starts indexing the 3k+ products.
- [ ] **In Search Console after submission**: URL Inspection → request indexing on `https://teno-store.com/` (forces apex recrawl, replaces stale Arabic snippet within ~24h) and on 3–5 sample product URLs (signals "this template has lots more like it").
- [ ] **Submit to Bing Webmaster Tools** — same flow at `https://www.bing.com/webmasters/`. Lower priority since IndexNow is already feeding Bing, but the dashboard exposes coverage stats IndexNow doesn't.
- [ ] **Run Google Rich Results Test** — `https://search.google.com/test/rich-results` on one product URL after seeding. Confirms the `Product` JSON-LD parses and shows the rich-card preview.
- [ ] **Flip Cloudflare SSL/TLS to Full (strict)** — already noted as TODO in `dns.md`.
- [x] ~~**Decide on French-language strategy** — either tag product pages with `og:locale=fr_DZ` or add `/fr` routes; punt until catalog ≥ 50 products.~~ Done — product page detects French content via the DZD-currency heuristic and tags with `og:locale=fr_DZ`, `<article lang="fr">`, and `inLanguage: "fr"` in the Product JSON-LD. Per-locale routing was rejected as overkill for the current catalog scale.
- [x] ~~**Optional but cheap:** add a `/about` page with substantive plain-text content describing how the marketplace works for sellers and agents.~~ Done — `/about` is live, listed in `sitemap.xml`, allowed in `robots.txt` for both `*` and the AI-bot allow-list.
