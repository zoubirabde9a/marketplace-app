# Deployment changelog

Append-only log of changes made to production servers. One entry per dated event. The point is traceability: if anything breaks, this file tells us what changed and when.

Format: `## YYYY-MM-DD — short summary`, then bullets.

---

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

## 2026-05-11 — vps-eu · web rebuild · SEO — strip leading Arabic boilerplate from product meta description + JSON-LD on French-tagged pages (9,309 / 30,028 long-desc products affected ≈ 31%)

- Algerian sellers commonly prepend a single Arabic delivery boilerplate line ("التوصيل متوفر لجميع الولايات" — "Delivery available to all wilayas") to descriptions that are otherwise in French. The site declares `<html lang="fr">` and tags `Product.inLanguage="fr"` in JSON-LD. Shipping Arabic-leading text in `<meta description>` + JSON-LD `Product.description` on a French-locale page sends Google a mixed-language signal that hurts both SERP snippet quality and ranking for French queries; sample product before this deploy was leading its snippet with `التوصيل متوفر لجميع الولايات Compatible avec la série P4…`.
- DB check across the live catalog: **9,309 of 30,028 (31%)** products with descriptions ≥40 chars start with an Arabic-script run. Single highest-coverage SEO lever shippable without operator action this iteration.
- Added `stripLeadingArabic(s)` helper in `packages/web/src/app/product/[id]/page.tsx`. Regex strips a leading run of Arabic-script (U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF) + whitespace/punctuation/digits/emoji up to the first Latin letter. Guarded so a fully-Arabic description is left intact (those sellers wrote a complete Arabic description; stripping to empty would force the template fallback and lose useful copy — let Google decide what to do with the language-shell mismatch on those minority pages).
- Wired into both call sites that feed Google's snippet pipeline: the `<meta description>` build in `generateMetadata` and the JSON-LD `Product.description` build downstream. Falls back to the raw seller text if stripping would leave less than `MIN_USEFUL_DESC_CHARS` (40); falls back further to the structured-French template (with category label from the earlier iter-3 deploy) if the surviving text is still too short.
- Verified live: sample Arduino/IPEGA product page now ships `Compatible avec la série P4 /XBOX-d'un commutateur de série…` as its meta description (was `التوصيل متوفر لجميع الولايات Compatible avec…`). Type-check clean; 8/8 product-page tests pass locally.
- Standing iteration-1 recommendation still open: Cache-Control middleware for anonymous HTML + Cloudflare Cache Rule (operator-side). Highest remaining lever.

## 2026-05-11 — vps-eu · web · stop /s/[id] from lying when an entity id is pasted into a snapshot URL

- The `/v1/snapshots/:id` API returns 410 with title "Snapshot expired or not found" for three different cases that the web page used to collapse into the same misleading "Snapshot expired — kept for 24 hours" message: (a) snapshot was real and has now actually expired, (b) snapshot was real but was evicted under Redis memory pressure before its TTL, (c) the id was never a snapshot to begin with — e.g. someone pasted a sellerId or productId UUID into `/s/<id>`. Case (c) is the most common way users hit this page incorrectly, and the old copy made the marketplace look broken when it wasn't.
- `/s/[id]/page.tsx` now does the right thing in each case:
  - **UUID-shaped id, not a snapshot, IS a known entity** → 307 redirect to `/store/<id>` (if seller) or `/product/<id>` (if product). One probe pair against the public API; the regex gate skips it entirely for genuine 22-char snapshot tokens.
  - **Genuine 410, no matching entity** → new copy "Snapshot unavailable / This snapshot is no longer stored …" explaining the three possibilities (expired / older than 24h / never a snapshot id) instead of falsely claiming the snapshot expired.
  - **404 (id failed the API's `[A-Za-z0-9_-]{16,64}` regex)** → "Snapshot not found" with a hint about what tokens actually look like.
- Verified: pasting a real sellerId into `/s/<uuid>` now redirects to `/store/<uuid>` (HTTP 307); a bogus token shows the new unavailable copy; a real fresh snapshot still 200s with the rich render. Web tests updated, full suite green.

## 2026-05-11 — vps-eu · web rebuild · fix seller-dashboard 400 + ship SEO/UX improvements (top-of-page catalog disclosure, "+ Vendre" header CTA, thin-description category enrichment)

- **Bug fix (seller dashboard 400 on POST /api/seller/sellers).** Operator hit `400 Bad Request` from the "Create seller profile" form on `/seller/dashboard`. The "raise quality bar" deploy earlier today tightened the API's `CreateSellerSchema` (`phone` + `countryCode` now required) but only `CreateSellerForm.tsx` was left submitting `{displayName}` alone, so every prod submission failed zod validation. Form now collects a phone number (`type=tel`, required) and ships `countryCode: "DZ"` as a hidden field (Algeria-primary marketplace; can be promoted to a visible select if/when we open up to other countries). BFF route `/api/seller/sellers/route.ts` and the typed `createSeller` helper in `lib/api.ts` updated to forward + require the new fields. French error copy for both the missing-displayName and missing-phone client-side validation.
- **UX: top-of-page catalog disclosure.** With infinite scroll on `/` and `/search`, the bottom-of-page CategoryFooter (categories/brands/sellers chips) was effectively unreachable. Moved `<CategoryFooter />` from below `<main>` to above it in `app/layout.tsx`, and converted it into a collapsible `<details>` element titled "Parcourir le catalogue · N catégories · M marques · K vendeurs" (collapsed by default so mobile viewport isn't pushed down). Bottom footer slimmed to the small nav + copyright. SEO note: this re-introduces the chips early in the byte stream that the source-order work earlier today was specifically trying to push down; `<details>` keeps the chips in HTML but visually nested behind a click. Monitor SERP snippet quality on `/search` over the next few days; if Google starts pulling chip text into snippets, revisit by making the disclosure CSS-only or limiting it to the home page.
- **UX: "+ Vendre" CTA in header.** Header gained an accent-coloured `+ Vendre` button linking to `/seller/products/new`, plus an `À propos` link on md+ viewports. Sticky header means the CTA stays visible during infinite scroll — the "I want to post" shortcut from any point in the catalog.
- **SEO: thin-content category label in product description fallback.** ~10,466 products (26% of the catalog) have a seller description under 40 chars and fall through to `buildProductDescription`'s template (`"Title · marque X · de Seller Y · NN DZD — annonce sur Teno Store, marketplace algérien."`). Only the title differed across same-brand thin pages — near-duplicate cluster food for Google's helpful-content system. Added the humanized French category label (from the existing `FR_CATEGORY` map: "Téléphones", "Véhicules", "Électronique & Électroménager", "Vêtements & Mode", "Immobilier", "Informatique", …) as a new second segment, flowing into both the `<meta description>` (SERP snippet) and the JSON-LD `Product.description` (Google product rich-card). Verified live: a sample Renault product page now ships `Renault Symbol … · Véhicules · marque Renault · de Auto Bazar Oran · 1 150 000 DZD — annonce sur Teno Store, marketplace algérien.`
- Deployed via tar-ship + `docker compose build web` + `up -d web`. `pnpm typecheck` clean, 108 web tests pass locally. Smoke: home 200, `/seller/dashboard` 307→login (correct for unauth), product `<meta description>` shows the new category segment.

## 2026-05-11 — vps-eu · redis · fix premature snapshot eviction (raise maxmemory 256mb→2gb, switch policy allkeys-lru→volatile-lru)

- Snapshots created hours earlier — well inside the documented 24h TTL — were returning 410 from `/v1/snapshots/:id`. Investigation: Redis `maxmemory=256mb`, `used_memory=234mb` (91%), `maxmemory-policy=allkeys-lru`. Each catalog snapshot is ~100 KB (full search-result blob); the scraper-driven `catalog.search` produces them continuously, so 256 MB fills inside an hour. Once over the cap, `allkeys-lru` evicted the least-recently-accessed keys regardless of their remaining TTL — including freshly-issued share-links nobody had clicked yet.
- Fix applied live (no restart, no data loss):
  - `CONFIG SET maxmemory 2gb` — VPS has 7.7 GiB total with 4.9 GiB available; 2 GB for Redis is comfortable headroom.
  - `CONFIG SET maxmemory-policy volatile-lru` — only TTL-bearing keys are eviction candidates. Snapshots and other ephemeral keys take the eviction hit first; any durable key (e.g. future session data) is preserved.
- Persisted the new values in `docker-compose.prod.yml` (Redis is started from inline `command:` args, no config file to `CONFIG REWRITE` against). A future `docker compose up -d redis` will pick up the new settings.
- Verified by issuing a fresh `seller.create_account` MCP call after the fix; `/v1/snapshots/...` and `/s/...` both return 200, store URL reachable. Older snapshots that had already been evicted stay gone — eviction isn't reversible — but anything created from this point on lives the full 24h.

## 2026-05-11 — vps-eu · web+mcp · public seller storefront page at /store/[id], wired into MCP outputs

- Earlier rounds gave every seller create + product create a 24h frozen snapshot, but the only buyer-facing "see this seller" URL was `/search?sellerId=…` — a filtered search-results page, not a storefront. A real marketplace gives each store a permanent destination with its name, location, contact channels, bio, and product grid.
- Added `/store/[id]` as the public seller storefront. Server-rendered for SEO; pulls `/v1/sellers/:id` for identity (display name, city/country, bio, multi-line phones with WhatsApp/Viber/primary tags, website, support email) and `/v1/products?sellerId=...` for the product grid. Schema.org `Store` JSON-LD embedded for search engines.
- The MCP `seller.create_account` response now carries `storeUrl` (permanent, public) alongside the existing `snapshotUrl` (24h, ephemeral). `product.create_listing` adds both `productUrl` (the public product page) and `storeUrl` (the owning seller's storefront).
- The `/s/[id]` snapshot page now CTAs into the live storefront: "View live storefront →" on seller-create snapshots, and "View live product page →" + "Go to store" on product-create snapshots. Buyers (and the operator) can jump from the verification snapshot to the durable customer URL with one click.
- `web/src/lib/api.ts` gets `getSeller(id)` and widens `SellerRecord` to expose `phones[]` / `description` / `city` / `countryCode` / `supportEmail`.
- Deployed via tar + `docker compose build api web && up -d api web`. No DB migration in this pass (data shape unchanged; just exposes more of what's already there). Full test suite green.

## 2026-05-11 — vps-eu · scraper+api+web · capture all seller phones from Ouedkniss (multi-line shops)

- Bug: the scraper-driven seeder was dropping every phone past the first. Ouedkniss publishes an ordered list of phones per shop (with per-number `hasWhatsapp` / `hasViber` flags); we were calling `pickPhone()` to keep only the first and using it for both the `phone` and `whatsapp` columns. A shop with three sales lines looked like a one-line shop, and every phone was falsely labelled WhatsApp-capable.
- Scraper (`scraper/scrape-ouedkniss.mjs`): GraphQL query on `mainLocation.phones` now requests `hasWhatsapp` and `hasViber`; output dump carries a `phoneEntries: [{phone, hasWhatsapp, hasViber}]` array alongside the legacy flat `phones[]` strings (kept for back-compat with older dumps).
- Seeder (`packages/db/src/seed-from-scraped.ts`): writes one `seller.seller_phones` row per phone (normalized to `+213XXXXXXXXX` E.164, deduped, first marked primary, `is_whatsapp` / `is_viber` set from real Ouedkniss signal rather than blanket-`true`). On re-encountering a previously-seen seller it calls `replacePhones(...)` so shops that add or remove a number get resynced instead of staying frozen on first-seen.
- API: `GET /v1/products/:id` now returns `sellerPhones: [{phone, isWhatsapp, isViber, isPrimary}, …]` (primary first). Legacy `sellerPhone` / `sellerWhatsapp` still populated from the primary / first-whatsapp for back-compat.
- Web product page: renders one chip per (phone × channel) — tel: for every number, wa.me for `isWhatsapp` numbers, viber:// for `isViber` numbers. Falls back to the legacy single-pair shape when the API hasn't been updated.
- DB: migration 0008 creates `seller.seller_phones` (FK to `identity.organizations(id) ON DELETE CASCADE`, partial unique index forcing ≤1 primary per seller, unique on `(seller_id, phone_e164)`). Backfill copied 420 existing single-phone sellers in as primaries with `source = 'backfill-seller-profiles'`. The legacy `seller_profiles.phone` / `.whatsapp` columns are kept and now act as cached mirrors of the primary / first-whatsapp number.
- New shared utility: `@marketplace/shared/phone` — `normalizeAlgerianPhone()` (accepts +213…, 213…, 0556…, 556… with arbitrary separators; rejects non-DZ E.164) and `formatAlgerianPhoneNational()`. 16 unit tests.
- Deployed via tar + `docker compose build api web` + one-off `compose run --rm api db:migrate` + `compose up -d api web caddy`. Scraper timer stopped during the build/migrate window (~3 min) and restarted after. Smoke: `/livez`=ok, product page 200, sample shop product returns 3 phones via API; web page renders 3 `tel:` links.
- Verified after one scrape cycle: `seller_phones` table now contains rows from `ouedkniss-store` source with multi-phone sellers (3-phone shops appearing for the first time in the catalog).

## 2026-05-11 — vps-eu · mcp+web · seller.create_account speaks the multi-phone shop model (phones[] with isWhatsapp/isViber/isPrimary)

- Earlier the same day, a parallel change introduced a normalized `seller.seller_phones` table (migration 0008) and widened `repos.sellers.create` to accept either legacy single-`phone`/`whatsapp` or the new `phones: [...]` shape. The MCP write tool wasn't using it yet — multi-line shops (separate sales / support / after-sales numbers, which Ouedkniss returns natively) couldn't be created through the agent path.
- `seller.create_account` MCP now accepts both shapes:
  - **Single-line shorthand**: `phone: "+213…"` (+ optional `whatsapp: "+213…"`) — what we already had.
  - **Multi-line shop**: `phones: [{ phone, isWhatsapp?, isViber?, isPrimary?, position? }, …]` — first-class. Numbers are normalised to Algerian E.164 (+213XXXXXXXXX) server-side, deduped per seller, and exactly one row is forced `is_primary` (the first if the caller marks none).
- Validation: the schema requires at least one of `phone` or `phones[]` and refuses both-empty. Tool description now documents the two shapes explicitly so an agent gathers the right info from the human before invoking.
- Response now carries `phones: [{phone, isWhatsapp, isViber, isPrimary}, …]` (primary first), in addition to the legacy `phone`/`whatsapp` convenience aliases (which mirror the primary + first-whatsapp).
- Product output now echoes the agent-provided `description` so the snapshot page can render it.
- Web `/s/[id]` seller-create renderer now shows the full phone list with per-line WhatsApp/Viber/primary tags, plus location (city + country) and bio. Product-create renderer now shows description + image previews (square thumbnails grid).
- Deployed via tar + `docker compose build api web && up -d api web` + `db:migrate` (0008 applied — `seller.seller_phones` table created with backfill from `seller_profiles.phone` for legacy rows). Full test suite green (594 tests; +2 new mcp-server tests covering multi-phone create + empty-phone rejection).

## 2026-05-11 — vps-eu · db+api+web · raise seller/product create quality bar (phone+country required, description+image required, store location added)

- Earlier the MCP write tools happily created stub sellers and image-less products from minimal input (just a display name and a SKU). That produced poor-quality storefronts and pushed the work of asking the human onto the agent's good intentions instead of the schema. Tightened both sides so the schema does the asking.
- **Seller** (`seller.create_account` MCP + `POST /v1/sellers`): `phone` and `countryCode` (ISO 3166-1 alpha-2) are now required inputs. New optional fields exposed: `city`, `description` (store bio, min 20 chars), `supportEmail`, `whatsapp`. The bug where `organizations.country_code` was hardcoded `"US"` for every new seller is fixed — the field now reflects the input (default `"DZ"` if a legacy caller passes nothing, since this marketplace is Algeria-primary).
- **Product** (`product.create_listing` MCP): `description` (min 30 chars) and `media` (min 1 publicly-fetchable image URL) are now required. `MediaInput.contentType` becomes optional — the server now infers it from the URL extension so an agent can pass `{ url: "…/photo.jpg" }` without having to know the mime type.
- **Tool descriptions** rewritten to explicitly instruct the calling agent to gather these fields from the human before invoking, rather than inventing minimal stubs.
- DB: added `seller_profiles.city varchar(120)` (nullable). Migration `0007_seller_city.sql` applied on vps-eu via `db:migrate`. No backfill needed (nullable column). The scraper-direct path still works since `repos.sellers.create` accepts new fields as optional.
- Web `/s/[id]` page renders the richer seller card (phone, whatsapp, location, bio) and richer product card (description + media list) when those fields exist on the captured snapshot.
- REST `POST /v1/sellers` matches the MCP validation. REST `POST /v1/products` left as-is for now (it serves the human seller-dashboard form, which uses multipart for image bytes — a coordinated UI change is a separate task).
- Deployed via tar + `docker compose build api web && up -d api web` + `db:migrate`. Full test suite green (575+ tests). Existing scraper-seeded sellers are unaffected (city = NULL; organizations.country_code = "US" for legacy rows, "DZ" going forward).

## 2026-05-11 — vps-eu · api+web · snapshot links for MCP write tools (seller.create_account, product.create_listing)

- Previously, only catalog *read* tools (`catalog.search` / `get_product` / `compare` / `recommend`) produced a 24h-frozen `snapshotUrl` an agent could hand to a human. Write tools returned only entity ids (`sellerId`, `productId`); pasting one of those into `/s/<id>` triggered the misleading "Snapshot expired" page (the API returns 410 for both expired and never-existed ids; web copy claimed expiry).
- Added `seller_create` and `product_create` to `catalog.SnapshotKind`. Both MCP write handlers now capture input + output into the same `SnapshotStore` (Redis-backed in prod, 24h TTL) and return `snapshotUrl` / `snapshotCreatedAt` / `snapshotExpiresAt` alongside their existing fields.
- Refactored `captureSnapshot` / `snapshotWebUrl` / `webBase` out of `packages/mcp-server/src/tools/catalog.ts` into a shared `snapshot-helpers.ts` so write tools reuse without duplication.
- Web `/s/[id]` page renders the two new kinds with dedicated views (seller card; product card with variants table) and a "What the agent created" heading instead of "What the agent saw".
- Deployed via tar + `docker compose up -d --build api web` (no env changes; the existing `RedisSnapshotStore` is shared with read tools).
- Tests: 3 new in `packages/mcp-server/test/seller-write-snapshot.test.ts`. Full suite green (575+ tests).

## 2026-05-11 — vps-eu · scraper-loop · drop sante_beaute from category rotation

- Operator wants the health/beauty category dropped from the scrape rotation (catalog focus). Removed `sante_beaute` from `--categories` in `deploy/systemd/marketplace-scrape-loop.service`; rotation now cycles 6 categories: `telephones, informatique, electronique_electromenager, vetements_mode, immobilier, automobiles_vehicules`. Each category gets a turn every ~6 minutes instead of ~7.
- Existing `sante_beaute` products in the catalog are left in place; they will age out naturally as the global 280k cap fills with newer per-listing-owned products.
- Deployed by scp of the updated unit file to `/etc/systemd/system/marketplace-scrape-loop.service` + `systemctl daemon-reload`. The currently-running iteration (if any) is unaffected; next timer fire uses the new category list.
- Also: caught the repo up with the per-listing-seller rewrite that was already deployed via rsync on 2026-05-11 (`scraper/scrape-ouedkniss.mjs`, `scraper/run-loop.sh`, `packages/db/src/seed-from-scraped.ts`). Working tree had drifted from the live server; these are now committed for traceability.

## 2026-05-11 — vps-eu · api · Redis response cache for /v1/products GETs

- Site sits behind Cloudflare in DNS-only mode (gray cloud, required because the proxy doesn't work reliably in Algeria), so no edge cache is available. Caching has to happen on the VPS itself.
- Added a generic Fastify response-cache plugin (`packages/api/src/middleware/response-cache.ts`) and wired it for `GET /v1/products` in `start.ts`.
- Caches the rendered JSON body in Redis keyed by full URL, TTL=30s (overridable via `RESPONSE_CACHE_TTL_SECONDS`). Only anonymous traffic (no `Authorization` header) is cached — we never reuse responses across principals.
- Writes are not invalidated; staleness is bounded by the TTL. Acceptable for a low-write catalog where the scraper seeds in batches.
- Response advertises `X-Cache: HIT|MISS` for observability.
- Deployed via rsync + `docker compose -f docker-compose.prod.yml up -d --build api`.

## 2026-05-11 — vps-eu · api · enable Node cluster mode (multi-core)

- Stress test showed `marketplace-api` was bottlenecked on a single CPU core (118% of one core under 5 concurrent search users; p99 ~10s, throughput ~3 req/s).
- Wrapped the API entry point (`packages/api/src/start.ts`) in Node's built-in `cluster` module. Primary forks N workers sharing the listening socket on :3100; on worker exit it respawns.
- Per-worker Postgres pool capped at `floor(40 / workers)` (min 5) so total connections stay well under `max_connections=100` with headroom for psql / seed-loop sessions.
- `docker-compose.prod.yml` passes `API_WORKERS=${API_WORKERS:-auto}` (auto = available cores capped at 4). Rollback: set `API_WORKERS=1` in `.env` and `up -d api`.
- Deployed via rsync + `docker compose -f docker-compose.prod.yml up -d --build api`.

## 2026-05-11 — vps-eu · scraper-loop · fix stored sourceUrl to canonical Ouedkniss format

- Scraper was writing `attributes.sourceUrl = "https://www.ouedkniss.com/annonce/<slug>"` — the legacy URL form. The current Ouedkniss SPA has no `/annonce/<slug>` route; that URL returns the SPA shell with no listing content. The canonical form on the live site is `https://www.ouedkniss.com/<slug>-d<id>`.
- Fix: `scrape-ouedkniss.mjs` now emits `${BASE_URL}/${it.slug}-d${it.id}` (both `id` and `slug` are already in the GraphQL response). Also surfaces `ouedknissId` in each scraped item for future tooling (e.g. an authenticated phone-reveal pass would need it as `announcementPhoneGet(id:)`).
- One-time dedup cost: products seeded before this fix carry the old URL in `attributes.sourceUrl`; the same Ouedkniss listing re-scraped after will appear novel because the new URL string won't match the old skip-urls dump. Expect a brief uptick in seeded counts as those listings re-enter under the canonical URL; future runs deduplicate normally.
- Deployed (scp scrape-ouedkniss.mjs to /opt/marketplace/scripts/, CRLF stripped). Verified by triggering the loop: new products created in the last minute show URLs like `…-dreame-x40-ultra-…-d51149353`. Direct `curl -I` against one such URL returns HTTP/2 200.
- Live tree audit: `seed-from-scraped.ts`, `run-loop.sh`, and the systemd unit on vps-eu are byte-identical (modulo line endings) to the repo. API image already carries the latest seeder from the morning's rebuild.

## 2026-05-11 — vps-eu · scraper-loop · per-listing seller resolution (with real phones for shop accounts)

- Every scraped product was being attached to the single hard-coded "Smart Phone DZ" seller, so the storefront showed one seller name + phone for everything. Replaced that with per-listing seller resolution: each unique Ouedkniss seller (a store id for shop accounts, a user id for individuals) now maps to one teno-store seller, persistent across runs.
- Scraper (`scrape-ouedkniss.mjs`): GraphQL query extended to capture `user { id }`, `isFromStore`, `store { id }` per listing. After scraping, the script collects the unique store ids and calls Ouedkniss's public `siteBuildGetByStore(storeId)` endpoint to pull each shop's `mainLocation.phones`, `emails`, and `socials` (website / facebook / whatsapp / telegram). Emits a `stores` map alongside `items` in the dump JSON.
- Phone-number posture, documented after investigation: Ouedkniss's `announcementPhoneGet(id)` mutation (the "show phone" button on listings) is auth-gated — anonymous calls return `[]` even with full browser headers (Origin, Referer, x-app-version, Chrome UA). The only public path to a real phone is the shop's site-build endpoint, which exposes the store's main-location phones. So:
  - **shop-account listings (`isFromStore=true`)** → real shop phone, email, website when present in the store profile
  - **individual-seller listings** → phone left null (operator policy: synthetic seller names allowed, synthetic phones never)
- Seeder (`packages/db/src/seed-from-scraped.ts`): added `resolveSeller(item)` that looks up an existing seller by deterministic `storeSlug` (`okk-store-<id>` for shops, `okk-user-<id>` for individuals) and creates one if absent. Display name is synthetic — `Vendeur Pro <5-hex>` for shops, `Vendeur <5-hex>` for individuals, derived from sha1 of the slug so the same Ouedkniss seller always gets the same name across runs. Phone/email/website set only when the store-enrichment step found real public values.
- `run-loop.sh`: `--seller-id` is now optional. When omitted (per-listing mode), the skip-urls dump pulls every product where `attributes->>'source' = 'ouedkniss-public-listing'` (so re-scraped listings are deduped across sibling sellers), and the prune query applies its cap globally to scraper-source products instead of one seller. State key shifted from `<seller>-<category>` to `global-<category>` in per-listing mode — page progress restarts at 1 for each category, which is acceptable.
- `marketplace-scrape-loop.service`: dropped `--seller-id` from `ExecStart`. Triggered one manual run after deploy: 50 telephones listings scraped, 7 unique stores enriched (6 with real phones), seeder created 14 distinct sellers (7 shops + 7 individuals), seeded 22 new products, 28 duplicates skipped. DB confirms 5 shop sellers carry real Ouedkniss phones (`+213780343697`, `0773589615`, `0550120130`, `0799003308`, `0775646256`), all individual sellers have `phone IS NULL`. No fabricated phones written for anyone.
- Known limitation: the existing ~21k products from before this change remain owned by the original Smart Phone DZ seller. They will age out naturally as the global 280k cap fills with per-listing-owned products; if you want them retired sooner, ask and I can delete them in a one-shot SQL pass.
- API image rebuilt in place (`docker compose -f docker-compose.prod.yml build api`); container not restarted because the seeder runs as a fresh `docker run` against the new tag — the live api keeps the old image until its next deploy.

## 2026-05-11 — vps-eu · scraper-loop · rotate across 7 top-level categories

- Scrape loop was pinned to `telephones` only — the systemd unit hard-coded that single category, so 100% of seeded products were phones/tablets despite the catalog being able to hold anything.
- Added `--categories <csv>` to `run-loop.sh`. When set, each run picks the next slug round-robin via a `_rotation/<seller>` counter stored in `run-loop-state.json`. Per-category `next_start_page` state is preserved independently, so each category resumes from where it left off.
- Updated `/etc/systemd/system/marketplace-scrape-loop.service` to pass `--categories telephones,informatique,electronique_electromenager,vetements_mode,sante_beaute,immobilier,automobiles_vehicules` (the seven top-level Ouedkniss categories per the `listingMenu` op).
- `daemon-reload`ed and verified with three manual triggers: picked `telephones` (idx 0), then `informatique` (idx 1), then `electronique_electromenager` (idx 2) — last run seeded 44 appliance/electronics products (Moulinex, Philips, Roborock, SMEG…). State file shows `_rotation` counter advanced to 3 and `019e08a4-…-informatique.next_start_page=3`.
- Cadence unchanged: still 1 run/min via the existing timer. Each category now gets a turn every ~7 minutes; per-category page progress advances at 1/7 the prior rate, which is fine since the catalog cap (`--max-products 280000`) is far above current size (21,125).
- Source-of-truth: `scraper/run-loop.sh` and `deploy/systemd/marketplace-scrape-loop.service` in the repo. CLAUDE.md's "canonical run" example still works unchanged (default behaviour without `--categories` is preserved).

## 2026-05-10 — vps-eu · scraper-loop · per-run log rotation added to data-rotate timer

- `data/logs/run-*.log` files accumulate one per scrape iteration (~1,440/day at 1/min cadence). 638 were present after one day. Each is tiny but uncapped growth would eventually matter.
- Extended `marketplace-data-rotate.service` to delete `run-*.log` files older than 7 days alongside the existing `ouedkniss-*.json` cleanup. Two `ExecStart=` lines now, both running on the same daily timer firing.
- Verified by `systemctl start marketplace-data-rotate.service` — both exit 0; no files removed yet because none have crossed the 7-day threshold yet (oldest is from today's session). Will start trimming automatically once the rolling window catches up.
- `metrics.jsonl` (single append-only file, currently 206 KB at ~75 MB/year growth rate) left alone — too small to be worth rotating right now. Revisit if/when it crosses ~50 MB.

## 2026-05-10 — vps-eu · api · wire MCP /mcp transport + admin-token auth path

- `POST /mcp` is now a live streamable-HTTP MCP endpoint on `api.teno-store.com`. Previously the route was declared in `packages/mcp-server/src/transport.ts` but never mounted in `packages/api/src/server.ts`; any request hit the auth middleware's blanket 401 and the MCP TS SDK then crashed parsing our RFC 7807 problem+json body against its RFC 6749 OAuth schema (the `/register` ZodError seen on the operator's laptop).
- Registered two write-side MCP tools (`seller.create_account`, `product.create_listing`) mirroring `POST /v1/sellers` and `POST /v1/products`. Scopes: `seller:write`, `seller:product:write`. Per-tool validation goes through the same domain layer as the REST routes — no duplicate sanitisation path.
- Added a shared-secret auth path for /mcp: `X-Mp-Mcp-Token` matching the `MCP_ADMIN_TOKEN` env var promotes an anonymous /mcp request to a synthetic agent principal with the full write scope bundle. This is a deliberate narrow exception to keep `DEV_BYPASS=0` in prod while still letting a trusted operator drive seller/product creation from a Claude Code MCP client. Token lives in `/opt/marketplace/.env` (mode 600, root-owned). Rotate by replacing the value and restarting api.
- Also: added `/register` + `/oauth/register` stubs returning an RFC 6749-shaped `registration_not_supported` so MCP TS SDK clients don't loop on OAuth Dynamic Client Registration; added `/mcp` to the idempotency middleware exempt list (JSON-RPC carries its own request id).
- Smoke: created seller `Tor-Store` (`019e13e0-c9cc-73f6-b21b-9a61562e2b35`) and 3 phone listings via MCP tool calls; verified via `GET /v1/sellers/<id>` → `productCount: 3`.

## 2026-05-10 — vps-eu · build · split Dockerfiles: install layer survives source edits

- The api + web Dockerfiles previously did `COPY packages ./packages` *before* `pnpm install`, so any source edit cache-busted the install layer and produced a fresh ~700 MB node_modules layer per rebuild. That's the structural cause of the 128 GB build cache that filled the disk earlier today.
- Fixed by copying only manifests (`pnpm-lock.yaml`, root + every `packages/*/package.json`) before install, then running `pnpm install`, then copying `packages/` source. Same pattern in both `Dockerfile` (api) and `packages/web/Dockerfile`. Source edits now produce a small source-only layer; install + node_modules layers are reused as long as no manifest changes.
- Deployed and verified: `docker compose -f docker-compose.prod.yml build api` succeeded under the new shape (1m53s clean build, image `marketplace-api:local` exported successfully). New image is built but the running api container has not been recreated — runtime behavior is identical, so deferred to the next natural deploy.
- Combined with the 72h-rolling `marketplace-docker-prune.timer` from the earlier entry, this should keep build cache bounded indefinitely. Expected steady state: each rebuild adds tens-of-MB of source/dist layer churn, which the daily prune wipes after 72h.

## 2026-05-10 — vps-eu · scraper-loop · catalog cap raised to 280k + automatic disk-hygiene timers

- **Root-cause of the earlier 124 GB disk fill:** Docker build cache (was 128 GB / 659 layers). Driven by `marketplace-api`'s monolithic Dockerfile — the main layer is `COPY /app /app` weighing 699 MB (entire monorepo, deps + dist), so each `docker compose build api` produces a fresh ~700 MB layer that barely shares with the previous one. With nothing pruning it, dozens of rebuilds → 100+ GB. Verified by re-checking 2h after the manual prune: cache had already grown back to 18 GB / 112 layers from normal deploys.
- **Catalog cap raised** from 14,200 → 280,000 (~20x) in `/etc/systemd/system/marketplace-scrape-loop.service`. With the loop adding ~5-30 products/minute net of dedup, the catalog will grow continuously (no pruning yet) for ~6 days before the cap kicks in. Postgres tables at 280k products are still small (~1 GB total products + media), well within the host's 230 GB free.
- **New systemd timer: `marketplace-docker-prune.timer`** — daily, runs `docker builder prune -af --filter until=72h`. Keeps the last 72h of build cache hot (so deploys stay fast on incremental rebuilds) and discards everything older. Worst-case loss = 72h of cache. Enabled.
- **New systemd timer: `marketplace-data-rotate.timer`** — daily, runs `find /opt/marketplace/data -maxdepth 1 -name 'ouedkniss-*.json' -mtime +7 -delete`. Caps scrape-JSON growth (~250 MB/day uncapped) at 7 days of dumps. Enabled.
- **Future-proofing note (not done now):** the long-term fix is splitting the api Dockerfile into separate deps + source layers, so `pnpm install` cache survives a source change. That'd cut rebuild churn from 700 MB → ~50 MB per rebuild and keep cache size bounded even without the daily prune. Worth doing when someone touches the Dockerfile next.
- Both new timers verified active: `systemctl list-timers marketplace-*` shows all three (scrape-loop, docker-prune, data-rotate). No restart of running containers needed.

## 2026-05-10 — vps-eu · scraper-loop · fixed inverted prune SQL (catalog was frozen) + CRLF deploy footgun

- The `--max-products` prune CTE in `scraper/run-loop.sh` had `ORDER BY created_at ASC OFFSET 14200` — that *keeps* the 14,200 oldest and *deletes* everything newer. Inverted from the intent stated in the operator's earlier changelog entry ("deletes oldest products"). The catalog had been frozen since 2026-05-10 18:38 UTC: every cycle seeded N fresh listings then immediately pruned those same N, net catalog change always 0. Discovered by querying `max(created_at)` and noticing it hadn't moved in ~3h despite hundreds of `seeded=N` reports in metrics.jsonl. One-character fix: `ASC` → `DESC` (so OFFSET skips the newest 14,200 and returns the older overflow to delete). Verified within one cycle: `min(created_at)` jumped from 2026-05-08 17:31 → 2026-05-09 20:05; `max(created_at)` jumped from 2026-05-10 18:38 → 2026-05-10 21:18; count stayed at 14,200.
- **Deploy footgun encountered**: my first scp of the patched `run-loop.sh` from a Windows working tree uploaded with CRLF line endings. The shebang `#!/usr/bin/env bash\r` failed under env (`env: 'bash\r': No such file or directory`), and every systemd-fired cycle from 21:13 → 21:17 UTC (5 in a row) failed with exit 127 before reaching the prune. Fixed in-place with `sed -i 's/\r$//'`. Note for future cross-platform deploys: scp from this Windows box must either use `git config core.autocrlf input` on the working copy OR strip CRs on the server after upload. The repo has `.gitattributes`-less files, so git's CRLF warnings are real.
- Loop is healthy again — last cycle (21:18:09 UTC) seeded 32, pruned the 32 oldest, catalog rolling forward at the cap.



- Closed the auth-bypass hole that let the assistant create "Tor-Store" earlier today. `/opt/marketplace/.env` now has `DEV_BYPASS=0` and the `I_UNDERSTAND_DEV_BYPASS_IS_INSECURE` ack flag is removed (backup at `.env.bak.<ts>-pre-bypass-off`). API container recreated. Negative test: `POST /v1/sellers` with `X-Mp-Agent-Id: agt_dev` now returns `401 dpop_token_required` (was: `201 Created`).
- The scraper loop kept working because it no longer touches the HTTP write path. `scraper/run-loop.sh` `run_seed()` was switched from the API-mode seeder (`scripts/seed-from-scraped.mjs`, which POSTs `/v1/products`) to the direct-DB sibling (`packages/db/dist/seed-from-scraped.js` from the api image). DATABASE_URL is built inline from `POSTGRES_PASSWORD` because compose constructs it at service-up time and it isn't a standalone var in `.env`. Data dir mounted read-only at `/data`.
- `packages/db/src/seed-from-scraped.ts` ported over the two HTTP-seeder features the loop depends on: `SKIP_URLS_FILE` env (newline-delimited URLs to skip; counted as `dups`) and a plain-text summary line `seeded N products, skipped M/K (D as already-seeded duplicates)` matching the run-loop parser regex. Doc-block updated.
- Also fixed a pre-existing latent pipefail trap in `scraper/run-loop.sh`: `NEW_URLS=$(grep ... | awk ... | sort -u)` had no `|| true` guard, so when the seeder logged 0 new product IDs the run-loop crashed at exit_code=1. The HTTP seeder always emitted plain-text product-id lines so this never tripped before; pino-JSON output from the direct-DB seeder needed a different grep + the guard.
- Deployed via `scp` of changed sources, `docker compose -f docker-compose.prod.yml build api`, then `up -d api`. Verified end-to-end: 4 successive systemd-fired loop cycles seeded 5/5/5/16 fresh listings via direct DB after the flip; `/livez` 200; metric-line shape unchanged (downstream cron summary parsers keep working).
- Phase 2 commit pending.



- Added a prune step to `scraper/run-loop.sh`: after each seed iteration, deletes oldest products for the seller (by `created_at ASC`) until the count is ≤ `--max-products`. Cascades clean up `catalog.media`, `catalog.product_variants`, and inventory rows. Refuses any cap < 100 to prevent typos nuking the catalog. Metrics line gained `pruned` and `max_products` fields.
- Updated `/etc/systemd/system/marketplace-scrape-loop.service` to pass `--max-products 14200` (the seller's current ~14,181 + headroom). `systemctl daemon-reload` applied; manual run confirmed: seeded 3 → pruned 3 → catalog steady at 14,200. Image bytes are not stored locally (media table holds only Ouedkniss URL refs), so no filesystem cleanup is required — this is purely a DB-row cap to keep the catalog fresh and bounded.
- Reclaimed 118 GB of disk via `docker builder prune -af` (build cache had grown to 128 GB across 659 layers — accumulated over weeks of api/web image rebuilds). Root partition went from 124 GB used (52%) to 6 GB used (3%). Did not touch images-in-use, named volumes (postgres data is intact), or running containers.
- Local code change in `scraper/run-loop.sh` is on disk in the repo; not yet committed.

## 2026-05-10 — vps-eu · db · rolled back accidental seller "Tor-Store" + locked down DEV_BYPASS

- An assistant-driven session created a seller named "Tor-Store" (`org_id 019e1322-f22b-7f5b-a6fe-99ae4de74711`, `seller_profiles.id 019e1322-f22b-7ad1-ab3f-7963e99ca53a`) by sending `X-Mp-Agent-Id: agt_dev` to `POST /v1/sellers`. This worked because `DEV_BYPASS=1` in `/opt/marketplace/.env` lets any caller act as any agentId with no credentials — see `packages/api/src/middleware/auth.ts:166`. Rolled back via `DELETE FROM identity.organizations WHERE id = '019e1322-...'` (cascades to `seller.seller_profiles`); confirmed 0 rows remain.
- Code: added a boot-time guard in `packages/api/src/start.ts` that refuses to start the API when `DEV_BYPASS=1` unless `I_UNDERSTAND_DEV_BYPASS_IS_INSECURE=1` is also set. Makes the bypass impossible to enable by accident.
- **Phase 1 deployed (option b).** Operator chose to keep the bypass on with the explicit ack flag while the scraper auth is fixed in a follow-up. `/opt/marketplace/.env` now carries both `DEV_BYPASS=1` and `I_UNDERSTAND_DEV_BYPASS_IS_INSECURE=1` (backup at `.env.bak.<ts>`). `start.ts` uploaded via `scp`, image rebuilt with `docker compose build api`, container recreated with `up -d api`. Verified `/livez` 200, container healthy, request log normal. Negative test (`docker compose run --rm -e I_UNDERSTAND_DEV_BYPASS_IS_INSECURE=0 api node packages/api/dist/start.js`) confirmed the boot guard prints the refusal message and exits.
- **Phase 2 follow-up (open):** switch `scraper/run-loop.sh` from the API-mode seeder (`scraper/seed-from-scraped.mjs`) to the direct-DB sibling (`packages/db/src/seed-from-scraped.ts`). Once that lands, flip `DEV_BYPASS=0` and remove the ack flag — closes the auth bypass for real.
- Commit `535a30f`.

## 2026-05-10 — vps-eu · web · agent-onboarding empty state rewritten for non-technical users

- `packages/web/src/components/AgentActivity.tsx`: previous version was a wall of curl + JWT + DPoP that only a developer could parse. Rewritten as plain-language click-through: lead path "Use with Claude Desktop" (3 numbered steps with a download link, MCP URL in a copy-to-clipboard widget, example natural-language prompt); secondary path "Use with another AI app" (same MCP URL + copy button); all curl/JWT/DPoP material moved behind a collapsed "For developers" `<details>`.
- `packages/web/src/components/CopyButton.tsx`: new client component, mirrors the ShareButton.tsx pattern (navigator.clipboard with window.prompt fallback). Emits "Copied" for 2s after click.
- Deployed via `tar | ssh` + `docker compose build web && up -d web`. Verified: `/livez` 200, `https://teno-store.com/` 200, web container restarted cleanly.
- Commit `66e9880`.

## 2026-05-10 — vps-eu · web · onboarding copy on signed-in home page (superseded)

- `packages/web/src/components/AgentActivity.tsx`: the empty-state on the signed-in dashboard previously promised "Connect an agent below to start watching its activity" with no actual instructions — users were left to guess. Replaced with a real onboarding guide: Option A points an MCP-compatible client at `https://api.teno-store.com/mcp`, Option B is a copy-pasteable `curl POST /v1/auth/passports` with all required fields (agentId, scopes, spendCaps, ttlSeconds, cnfJwk). Links to `/.well-known/agents.json` for the full protocol surface. Split the empty-state into two cases so users who already have an agent linked but no activity yet still see the original "Nothing here yet" copy, not the connect guide.
- Deployed via `tar | ssh` + `docker compose -f docker-compose.prod.yml build web && up -d web`. Verified: `/livez` 200, `https://teno-store.com/` 200, web container restarted cleanly. New copy renders only for signed-in users (component is gated on session); confirmed unauthenticated home still excludes it.
- Commit `358f039`.

## 2026-05-10 — vps-eu · web · pluralise SEO copy, cache CategoryFooter facets in module memory

- `packages/web/src/app/search/page.tsx`: metadata description and the FR/EN intro copy (`SliceIntro`, `BareCatalogIntro`) now switch noun forms based on `totalCount` (1 vs ≠1). Previously a single-result page shipped "1 listings matching …", which reads as low-quality content to SERP snippets and to humans.
- `packages/web/src/components/CategoryFooter.tsx`: replaced `next: { revalidate: 600 }` with a module-level in-memory cache (10-min TTL, in-flight singleton, only caches non-empty payloads). The Next data-cache hint was apparently being ignored — iter-29 logs showed `/v1/products?limit=1` hitting multiple times per second from the footer alone, contributing to the api healthcheck failure streak that flipped api unhealthy / 502. Same pattern that fixed sitemap.ts works here.
- `packages/web/src/app/sitemap.test.ts`: clear the new module cache between tests via `__resetSitemapCacheForTests` (mirrors the existing sitemap.ts harness).
- Deployed via `tar | ssh` + `docker compose -f docker-compose.prod.yml build api web && up -d api web caddy`. Verified: `/livez` 200, `https://teno-store.com/` 200, sitemap entries 13643, `/search?q=zzznoresult123` renders "0 listings matching".
- Commits `991ec3e` (web fixes) + `d1acca8` (probe-teno.ps1 helper).

---

## 2026-05-10 — vps-eu · catalog · "newest" sort now keys on real posting date, not ingestion time

- `packages/api/src/catalog/sort.ts`: when `sort=newest`, comparator now reads `attributes.sourcePostedAt` (ISO 8601 from the seller's Ouedkniss listing) and falls back to `createdAt` when missing. Browsing `/search` defaults to `sort=newest` whenever there's no query, so this is the path users hit by default.
- Why: the scraper walks Ouedkniss pages in arbitrary order across runs, so ingestion time didn't track real freshness — a freshly-posted listing could land below an old one re-ingested earlier.
- Deployed via `tar | ssh` + `docker compose -f docker-compose.prod.yml build api && up -d api`. Verified: top 5 of `GET /v1/products?sort=newest` are listings posted within the last ~10 min.
- Cursor format unchanged (still ms-since-epoch); users mid-scroll at deploy time see a small ordering glitch on next "load more", resolves on reload.

---

## 2026-05-10 — scrape-and-seed loop runs autonomously via systemd timer, with status.sh and full README

- The minute-cadence loop is now driven by a **systemd timer on `vps-eu`**, not a Claude session cron. Survives reboots, runs without an open Claude session, observable via `journalctl`, zero token cost per iteration.
  - `/etc/systemd/system/marketplace-scrape-loop.service` — `Type=oneshot`, runs `/opt/marketplace/scripts/run-loop.sh --seller-id 019e08a4-97cd-7d98-afd7-670878dc51c2 --quiet` as root, sandboxed (`ProtectSystem=strict`, `ReadWritePaths=/opt/marketplace/data`, `PrivateTmp=true`, `NoNewPrivileges=true`), `TimeoutStartSec=240`, `Restart=no` (next timer fire is the retry path; restarting would race the script's flock).
  - `/etc/systemd/system/marketplace-scrape-loop.timer` — `OnCalendar=*:0/1`, `RandomizedDelaySec=10` (jitter so a fleet of these don't synchronise on the same instant), `Persistent=false` (no replay-storms after downtime).
  - Verified: timer fired 6 times in 6 minutes after install, all `Result=success ExecMainStatus=0`, catalog grew normally.
- New operator tool **`scripts/status.sh`** prints, in one shot: timer state + next fire, last service invocation + exit code, last N runs from `metrics.jsonl` as a column-aligned table, aggregate totals (runs / seeded / dup_skipped / invalid_skipped / idle), page-progression state per `<seller>-<category>`, and any `[error]/[warn]/exit_code=N≠0` lines from the last 20 run logs. Flags: `-n N` (default 10), `--errors`, `--tail` (live-follow `metrics.jsonl`).
- New comprehensive **`scraper/README.md`** covers the full pipeline: TL;DR ops snippets, what the loop does end-to-end, file inventory, prod-paths table, every checking-status path (`status.sh`, `journalctl`, raw `metrics.jsonl`, per-run logs), exit-code table, every CLI/env knob with defaults, auth posture (`DEV_BYPASS=1`), common operations (pause/resume/reset-state/single-page-slice/script-deploy/scrape-JSON cleanup), troubleshooting matrix, ASCII architecture diagram, legal/privacy posture.
- Cancelled the prior Claude-session cron `c01da86f` so we don't have two parallel triggers. The session-cron approach was useful for getting the loop iterated and hardened in real-time during the build session; once the script was stable, systemd is the right home.

---

## 2026-05-10 — IndexNow: pushed full catalog to Bing/Yandex/Seznam/Naver

- Verified via web search that `site:teno-store.com` returns 1 result (apex only) with a stale Arabic snippet from a prior domain owner. Zero product URLs in Google's index. Google Search Console submission is still gated on the operator's Google login.
- Set up IndexNow as the un-gated alternative: host key `81b0a3ff408a96ef5c0381a78aae7f58` at `packages/web/public/81b0a3ff408a96ef5c0381a78aae7f58.txt`, served at `https://teno-store.com/<key>.txt` (200 OK verified).
- New `scripts/indexnow-submit.mjs` reads the live `/sitemap.xml`, chunks at 500 URLs/request with a 1s pause (10k single-shot was rejected with 403 — likely a cold-start abuse heuristic), and POSTs to `https://api.indexnow.org/indexnow`. `--stdin` mode accepts URLs on stdin for ad-hoc use (newly-seeded products from the run-loop).
- One-time bulk push completed: 3,206/3,206 URLs accepted (status 200 across 7 chunks). Bing also feeds DuckDuckGo and ChatGPT search, so this materially improves agent-discovery beyond Google.
- Updated `deploy/STATUS.md` (catalog ~17 → ~3,200, added discovery section) and `deploy/seo.md` (action checklist + indexing diagnosis).

---

## 2026-05-10 — vps-eu — search synonym expansion deployed to api

- Shipped `packages/db/src/synonyms.ts` + the matching `searchIds` change to vps-eu via tar | ssh, mirrored `scraper/{run-loop.sh,scrape-ouedkniss.mjs,seed-from-scraped.mjs}` into `/opt/marketplace/scripts/`, rebuilt `marketplace-api` (`docker compose -f docker-compose.prod.yml build api && up -d api`).
- Verified live: `GET https://api.teno-store.com/v1/products?q=frigo&limit=3` → "Réfrigérateur LG 500L No Frost" (synonym frigo→refrigerateur picked it up). `q=tlf` → 200 hits (tlf→telephone).
- Why: users type the abbreviations they actually use ("frigo", "tlf"); without the synonym map those queries returned 0 hits despite matching catalog inventory.

---

## 2026-05-10 — scrape-and-seed loop now walks pages progressively (state-tracked)

- Problem: with PAGES=2 fixed at the top of the listings, after ~10 minutes the loop was idle every iteration — page-1 was fully covered and dedup left nothing to seed. Catalog stuck around 290 products despite Ouedkniss having thousands of listings deeper.
- Fix in two parts:
  1. `scripts/scrape-ouedkniss.mjs` now reads `START_PAGE` env (default 1). Pages walked are `START_PAGE..START_PAGE+PAGES-1`. The output JSON gains `startPage`, `lastPageScraped`, `hasMorePages` so callers can advance.
  2. `scripts/run-loop.sh` keeps a per-seller-per-category state file (`/opt/marketplace/data/run-loop-state.json`) with `{next_start_page: N}`. Each successful run advances by `PAGES`; when the scraper reports `hasMorePages=false`, state wraps to 1 (full category re-walked from the top).
- Also dropped the in-script `MAX_AGE_DAYS=3` filter (now `MAX_AGE_DAYS=0`) so older listings on page 5+ aren't dropped before the seeder sees them.
- New CLI flags on run-loop: `--start-page N` (override one run, state still advances), `--reset-state` (force `next_start_page=1`), `--state-file PATH`.
- Stdout summary expanded: `OK pages=X..Y next=Z before=… after=… delta=… seeded=… …`. Metrics JSONL gains `start_page`, `last_page`, `has_more`, `next_start_page`.
- Verified: first run after deploy went `pages=1..2 next=3 delta=0 dup=48` (page 1 saturated as expected), second run `pages=3..4 next=5 delta=7 dup=43` — actually surfacing fresh listings.

---

## 2026-05-10 — single-script orchestration for the scrape-and-seed loop

- Replaced the multi-line `docker exec psql … && docker run scrape … && docker run seed …` pipeline with one bash script: `scraper/run-loop.sh` in the repo, deployed to `/opt/marketplace/scripts/run-loop.sh`.
- Production-grade behaviour:
  - CLI args (`--seller-id`, `--category`, `--pages`, `--max-listings`, `--base`, `--scrape-retries`, `--seed-retries`, `--reuse-recent-scrape`, `--no-dedup-refresh`, `--dry-run`, `--quiet`, `--log-dir`, `--help`).
  - Prereq checks: docker on PATH, `marketplace-api` and `marketplace-postgres` containers running, `marketplace_default` network present, `/opt/marketplace/.env` and `/opt/marketplace/scripts/` exist. Pulls `node:22-alpine` if missing.
  - Retries with exponential backoff: skip-urls refresh (×2), scrape (×3), seed (×2). Each step's failure mode has its own exit code (4/5/6).
  - flock-based lock (`run-loop.lock`) prevents concurrent runs (exit 7).
  - Per-run human-readable log at `data/logs/run-<RUN_ID>.log`; append-only structured JSONL metrics at `data/logs/metrics.jsonl` (one object per run with before/after/delta/seeded/dup_skipped/invalid_skipped/scrape_listings/skip_urls_count). Trivial to feed a dashboard later.
  - One-line stdout summary `OK before=… after=… delta=… seeded=… dup=… invalid=… log=…` for cron-style invocations.
- Cron prompt for the loop is now the trivial one-liner `ssh vps-eu /opt/marketplace/scripts/run-loop.sh --seller-id <UUID>` instead of the prior 50-line composite.
- `CLAUDE.md` updated to point at the script as the canonical entrypoint.

---

## 2026-05-10 — infinite scroll on `/search`

- Replaced the prev/next pagination control on `/search` with infinite scroll. First page is still rendered server-side (so SEO, JSON-LD `ItemList`, OG tags, and crawler reachability are unchanged). A new client component `InfiniteResults` watches an off-screen sentinel via IntersectionObserver and pulls the next cursor's worth of hits as the user nears the bottom.
- New JSON endpoint `app/api/search/route.ts` proxies `searchProducts(parseSearchParams(...))` and returns `{ data, cursor }`. Same query parsing as the page, so all active filters carry forward.
- Removed `components/Pagination.tsx` and its test (no longer used).
- Build + deploy via the standard `tar | ssh` + `docker compose build web && up -d web` flow on `vps-eu`.

---

## 2026-05-10 — scrape-and-seed loop now de-duplicates on `sourceUrl`

- Problem: running the scrape-and-seed loop every minute produced ~50 new products per iteration that were content-duplicates of the previous iteration (same Ouedkniss listings, same images, just new `productId`s). Catalog inflated 64 → 412 in a few minutes; ~237 of those were duplicates.
- Why the SKU constraint didn't help: `catalog.products` has `UNIQUE (seller_id, sku)`, but the API auto-generates the product-level `sku` as `prd-<random>`; the seeder's variant SKU lives on `catalog.product_variants` and its uniqueness is `(product_id, sku)` — per-product, not per-seller. So same-seller dups under different generated `prd-*` SKUs slide through.
- Fix in `scripts/seed-from-scraped.mjs` (and `scraper/seed-from-scraped.mjs` in the repo): added `SKIP_URLS_FILE` env. When set, the seeder reads a newline-delimited file of sourceUrls and skips any incoming listing whose `url` matches. Logs `... (D as already-seeded duplicates)`.
- Canonical run (now 3 steps — see updated `CLAUDE.md`):
  1. `docker exec marketplace-postgres psql ... > /opt/marketplace/data/skip_urls.txt` to dump existing sourceUrls for the target seller.
  2. Run `scripts/scrape-ouedkniss.mjs` as before.
  3. Run `scripts/seed-from-scraped.mjs` with `SKIP_URLS_FILE=/work/data/skip_urls.txt`.
- Cleanup of the existing duplicates accumulated this morning: `DELETE FROM catalog.products WHERE id IN (... rn > 1 ...)` partitioned by `attributes->>'sourceUrl'`, keeping the oldest per URL. Two passes (the first patch attempt added another ~36 dups before this `SKIP_URLS_FILE` approach landed); 237 + 36 rows deleted total. ON DELETE CASCADE on the dependent tables (`product_variants`, `media`, `digital_assets`, `product_embeddings`, `product_versions`, `listing_canonical_suggestions`) means a single DELETE on `catalog.products` was sufficient.
- Verified working: scrape returned 50 listings; with skip-list of 176 existing URLs preloaded, the seeder seeded 2 (genuinely new), skipped 48 as duplicates. Catalog `totalEstimate` went 193 → 195.
- Also dropped `attributes.source` and `attributes.sourceCategory` from new product writes (operator request — they were noise; only `sourceUrl` and `sourcePostedAt` remain).
- Also fixed a SKU-too-long edge case discovered along the way: variant SKU was capped at 60 chars including the `scraped-` prefix; backend rejects > 64. Reduced to 56.

---

## 2026-05-10 — show seller phone digits on product page

- `packages/web/src/app/product/[id]/page.tsx`: replaced the generic "Call" / "WhatsApp" chip labels with the actual `sellerPhone` / `sellerWhatsapp` digits in monospace, LTR-forced. Buyers can now see and copy the number without clicking into the click-to-call link.
- Display format is Algerian-local: `+213` country code is stripped and a leading `0` is added (e.g. `+213555000101` → `0555000101`). The underlying `tel:` and `wa.me/` hrefs keep the international form so dialing still works from outside Algeria.
- Shipped via the standard `tar | ssh` + `docker compose build web && up -d web` flow on `vps-eu`. Verified on https://teno-store.com/product/019e1117-56fb-714d-977f-a0c7c4a2fa4b.
- API data shape unchanged (single string per channel). Multi-number support, if needed, would require a backend schema change.

---

## 2026-05-10 — `DEV_BYPASS=1` left on; scrape-and-seed loop end-to-end working

- Operator decision: leave `DEV_BYPASS=1` set on `vps-eu:/opt/marketplace/.env` so the scraper-feeding loop (`scripts/scrape-ouedkniss.mjs` → `scripts/seed-from-scraped.mjs`) can write to `https://api.teno-store.com` without per-iteration auth juggling. Container recreated with `docker compose -f docker-compose.prod.yml up -d api` (NOT `restart` — see gotcha below).
- **Operational gotcha discovered**: `docker compose restart api` does NOT re-read `.env`; the existing container keeps the env it was created with. After editing `.env`, recreate with `up -d` (or `down api && up -d api`). An earlier attempt today flipped `.env` to `DEV_BYPASS=1`, used `restart`, observed all 50 POSTs return `401 dpop_token_required`, and incorrectly concluded the `DEV_BYPASS` code path had been removed. It hasn't — it's still in `packages/api/src/middleware/auth.ts:167`. The container just hadn't picked up the new env. Updating runbook 06 to make this explicit.
- End-to-end pipeline verified working with 50-product Ouedkniss scrape:
  - Scrape: `docker run --rm --network marketplace_default -v /opt/marketplace:/work -w /work -e PAGES=2 -e PAGE_SIZE=48 -e MAX_LISTINGS=50 -e BATCH_PAUSE_MS=2000 node:22-alpine node scripts/scrape-ouedkniss.mjs` → 50 listings to `data/ouedkniss-telephones-2026-05-10T08-49-52-131Z.json`.
  - Seed: same container shape with `MARKETPLACE_BASE=http://api:3100`, `SELLER_ID=019e08a4-97cd-7d98-afd7-670878dc51c2` (Smart Phone DZ) → seeded 49, skipped 1/50.
  - Catalog count: 64 → 113 (`GET /v1/products → pagination.totalEstimate`).
  - Public render verified: `https://teno-store.com/product/019e1117-57ea-7f7c-959b-295f869949ac` returns 200 with the title ("GameSir Nova 2 Lite") and all 5 Ouedkniss CDN image URLs in the HTML; one image fetched directly returned 200 `image/jpeg` 20.6 KB.
- **Security implication of leaving `DEV_BYPASS=1` on**: anyone who can reach `https://api.teno-store.com` can `POST /v1/products` (and other writeable endpoints) with arbitrary `x-mp-*` headers and act as any principal. Catalog is effectively writeable by anonymous internet until reverted. Mitigations available if abuse appears: revert (`DEV_BYPASS=0` + `up -d api`), front writes with a Cloudflare WAF rule, or move to a real DPoP agent passport.

---

## 2026-05-10 — relocate scraping code to `scraper/`

- Moved `scripts/scrape-ouedkniss.mjs` → `scraper/scrape-ouedkniss.mjs` and `scripts/seed-from-scraped.mjs` → `scraper/seed-from-scraped.mjs` via `git mv` (history preserved).
- New `scraper/README.md` consolidates scraping-specific docs: file inventory, legal/privacy posture (Ouedkniss ToS / Algerian Law 18-07 / GDPR), end-to-end usage (scrape → seed under a synthetic seller), and the env-knob reference for both scripts.
- Updated in-file usage strings in both moved scripts to reflect the new `scraper/...` paths.
- Trimmed the inline scraper details from `deploy/runbooks/06-seed-catalog.md` Path B; runbook now points at `scraper/README.md` for the full reference and shows the minimal scrape→seed command pair.
- Updated `deploy/STATUS.md` "Scripts at the repo root" to list the scraper scripts under `scraper/` with a link to the new README.
- Updated the comment in `scripts/seed-dated-products.mjs` that referenced `scrape-ouedkniss` → `seed-from-scraped` to use the new paths.
- No code-behaviour change. Production runtime is unaffected (the scraper runs on the operator's laptop, not on `vps-eu`).

---

## 2026-05-09 — second cause for `teno-store.com` intermittency: client-ISP route to CF (runbook 08)

- While debugging a "product page is very slow" report (`/product/019e0e58-…`), found that every connection from the operator's laptop to one of the two Cloudflare anycast v4 IPs returned for `teno-store.com` (`172.67.185.97`) was timing out, while the other (`104.21.84.29`) worked in ~200 ms.
- `tracert` from laptop: path to `172.67.185.97` dies at hop 8 inside Algerie Telecom (`41.110.38.3` → blackhole). Path to `104.21.84.29` traces cleanly to Cloudflare in ~100 ms. Same path from `vps-eu` (different ASN) hits both IPs fine.
- Conclusion: **second, distinct, root cause** — Algerie Telecom (AS36947) has intermittent broken routes to **multiple Cloudflare anycast blocks**, and which block is broken **shifts over hours** (earlier in the session `172.67.0.0/16` was unreachable; two hours later `172.67/16` recovered but `188.114.96.0/20` went broken instead). DNS for `teno-store.com` rotates which CF IPs it returns; whichever block the OS draws decides whether the connection succeeds. This is **client-ISP-side, neither Cloudflare nor origin can fix it.**
- Confirmed by temporarily flipping the apex DNS record to grey-cloud — site loads fine because DNS then returns the origin IP directly, bypassing the broken AT→CF path. Reverted to orange immediately afterwards.
- **Decision: stay orange (proxied).** Accept the intermittency for affected users until the AT route self-heals or they fix it. No firewall, no Caddyfile, no DNS change today.
- Did not file a netcup ticket for the earlier-discovered ~10 % SYN-loss issue (cause A). Both causes documented; netcup ticket draft retained in runbook 08 for if/when we want to act on it.
- Updated `deploy/runbooks/08-cloudflare-intermittent-slowness.md` to clearly separate the two causes (netcup-side SYN drops vs client-ISP CF anycast route), with a table for quick triage.

---

## 2026-05-09 — diagnose intermittent ~7.7 s `teno-store.com` hangs (runbook 08)

- Reproduced from operator laptop: a small fraction of requests (~5–25 %) take ~7.71 s; rest are ~200 ms. Same ratio also affects raw SSH (port 22) to `vps-eu`, which means it's not Caddy/HTTP and not Cloudflare.
- Verified on `vps-eu`: `TcpExtListenDrops=0`, `TcpExtTCPBacklogDrop=0`, conntrack 251/262144, NIC RX errors 0, fail2ban only has `sshd` jail (no CF range banned), `ufw` has no rate-limit, all containers healthy, app responds <10 ms from inside the box. The dropped SYNs never reach the host kernel.
- **Root cause: TCP SYN loss between netcup's network and the VPS, port-agnostic.** Action item is a netcup support ticket; the box itself is fine.
- The Cloudflare-edge "7.7 s" pattern is a derived symptom: CF's 5 s connect_timeout + retry on a dropped SYN ≈ 7.7 s wall clock at the user.
- Recorded full diagnosis in `deploy/runbooks/08-cloudflare-intermittent-slowness.md` (rewrote — earlier draft hypothesised fail2ban / IPv6, both ruled out).
- Added `scripts/probe-cf.mjs` (uses `https.request` with fresh connections per request so it actually samples across CF edge IPs) and `CLAUDE.md` at repo root that explicitly authorizes `ssh vps-eu '<cmd>'` for diagnostic work — this gap is what made the first pass of the diagnosis miss the fact that `ssh vps-eu` is the normal way to operate, and waste a turn asking the operator instead.
- Tcpdump installed on `vps-eu` (`apt-get install tcpdump`) — was missing.

---

## 2026-05-09 — ship `snapshotUrl` on REST catalog reads to `vps-eu`

- Targeted deploy: `scp` of just `packages/api/src/routes/products.ts` and `packages/api/src/server.ts` to `/opt/marketplace/` (deliberate two-file copy instead of the full `tar | ssh` flow that hit the `.env` overwrite incident in the previous entry).
- Added `MARKETPLACE_WEB_BASE_URL=https://teno-store.com` to `/opt/marketplace/.env` (backup taken at `.env.bak.snapshoturl`, mode 600 preserved). The env var was previously unset, which is why no `snapshotUrl` was emitted on REST despite the SnapshotStore being wired up.
- `docker compose -f docker-compose.prod.yml build api` then `up -d api` — only `marketplace-api` recreated; `caddy`, `web`, `redis`, `postgres` untouched and stayed up.
- Smoke tests from the server: `https://api.teno-store.com/livez` → 200; `GET /v1/products?q=iphone&limit=2` returns `snapshotUrl: https://teno-store.com/s/<token>`, `snapshotCreatedAt`, `snapshotExpiresAt`; `GET /v1/snapshots/<token>` echoes the frozen kind=`search` payload; `GET /v1/products/{id}` also emits the trio with kind=`product`. All five containers healthy at end of deploy.
- Code committed in `e9443c0` on `main` along with SPEC §8.4 / `.env.example` / `packages/web/README.md` doc updates.

## 2026-05-09 — sync local working tree to `vps-eu`, rebuild api+web

- Ran `pnpm typecheck` (clean) and `pnpm test` (451 passed, 1 skipped) on the operator laptop.
- Shipped working tree via `tar | ssh vps-eu` per runbook 07. ~22 source-file diffs vs the live tree (14 modified, 8 new).
- **Incident:** the laptop's local `.env` (dev profile, missing `POSTGRES_PASSWORD`) overwrote `/opt/marketplace/.env` because `tar` did not exclude it. First `docker compose ... up -d` aborted on `POSTGRES_PASSWORD missing`. Recovered the production secrets by inspecting the still-running `marketplace-api` container's `Config.Env` (Postgres password, audience, Google client ID, etc.), wrote a fresh `/opt/marketplace/.env` (mode 600, owned by `root`), then re-ran the build. **Follow-up:** add `--exclude='.env'` and `--exclude='.env.*'` to the `tar` command in runbook 07's TL;DR before the next deploy.
- `docker compose -f docker-compose.prod.yml build api web` succeeded; `up -d api web caddy` recreated `marketplace-api` and `marketplace-web` (postgres/caddy left running). Redis container was also recreated since the image had been pulled fresh; data is on host bind-mount `/var/lib/marketplace/redis` so no loss.
- Smoke tests from `vps-eu` (operator laptop's outbound 443 to `*.teno-store.com` is blocked locally — verified from the server instead): `https://api.teno-store.com/livez` → `{"status":"ok"}`, apex → 200, `www` → 301, `sitemap.xml` → 19 `<loc>` entries (matches expected 17 products + apex + `/search`), `/v1/products` returns the seeded catalog.
- All five containers healthy at end of deploy: `caddy`, `web`, `api`, `redis`, `postgres`.

## 2026-05-08 — `vps-eu` provisioned

- Purchased a netcup VPS (Nuremberg, DE). Provider hostname `v2202605356582457645.nicesrv.de`, public IPv4 `152.53.147.77`, IPv6 `2a0a:4cc0:c1:2d20:a816:a4ff:fe07:7870`.
- Provider issued initial root password — stored in `deploy/.env` as `VPS_EU_ROOT_PASSWORD`. Will be invalidated as soon as key auth is in place (runbook 02 → runbook 03).
- Verified TCP/22 reachable from operator workstation (`Test-NetConnection 152.53.147.77 -Port 22` → True).
- Captured server SSH host key fingerprint: `SHA256:QbOixuW2NdARlc11JVyX0ysFGMCWk99a70JQoXBih/c` (ED25519). Recorded in `servers.md`. Persisted to operator's `~/.ssh/known_hosts`.
- Generated dedicated keypair for this server: `~/.ssh/vps-eu_ed25519` (fingerprint `SHA256:gZOqaLJdYSyyuEMU8UBUjfLTiOePDb0xDDDGWS6H0/Q`). Public key recorded in `servers.md`.
- Added `Host vps-eu` block to operator's `~/.ssh/config` with `KexAlgorithms curve25519-sha256` (Windows OpenSSH 9.5 can't negotiate the post-quantum default).
- Confirmed handshake reaches the auth stage (got `Permission denied (publickey,password)` — expected, key is not yet installed on the server).

**Next:** complete runbook 02 by installing the public key into `root@vps-eu:~/.ssh/authorized_keys`, then verify passwordless login.

## 2026-05-08 — `vps-eu` SSH bootstrap completed (runbook 02)

- Installed `vps-eu_ed25519.pub` into `root@vps-eu:~/.ssh/authorized_keys` (mode 600, dir 700, owner root). The install was done by piping the pubkey over a one-shot password-auth ssh session driven by `SSH_ASKPASS` so no password ever crossed the screen.
- Diagnosed and fixed a self-inflicted bug: the keypair was generated with `ssh-keygen -N '""'` in PowerShell, which sets the *literal two-char string* `""` as the passphrase rather than an empty passphrase. Symptom in verbose ssh log: `Server accepts key` followed by `we did not send a packet, disable method` (i.e. ssh saw the key was authorized but couldn't sign with it). Fixed in place with `ssh-keygen -p -f vps-eu_ed25519 -P '""' -N ""`. Documented in `servers.md` so we don't repeat it.
- Tightened Windows ACL on `vps-eu_ed25519` to user-only (`icacls /inheritance:r /grant:r "%USERNAME%:(F)"`) — defensive, though not the root cause here.
- Verified: `ssh vps-eu "hostname && id && uname -a"` returns exit 0 with no password prompt. Server reports kernel `6.12.85+deb13-arm64` — **the box is arm64**. Updated `servers.md` and `protocols.md`-relevant note (Docker images need `linux/arm64`).

**Next:** runbook 03 — enable ufw, install fail2ban + unattended-upgrades. Password auth stays enabled (operator decision: simpler recovery path; brute-force handled by fail2ban). `VPS_EU_ROOT_PASSWORD` remains the canonical root password record.

## 2026-05-08 — DNS for `teno-store.com` set up at Cloudflare

- Added `teno-store.com` to Cloudflare (Free plan). Cloudflare-assigned nameservers: `benedict.ns.cloudflare.com`, `rosemary.ns.cloudflare.com`. Nameservers updated at the registrar; propagation confirmed (`nslookup ... @1.1.1.1` resolves via Cloudflare).
- Created records pointing the apex, `www`, and `api` at `vps-eu` (`152.53.147.77` / `2a0a:4cc0:c1:2d20:a816:a4ff:fe07:7870`). All six records (3 × A + 3 × AAAA) are **proxied** (orange cloud) — verified via `nslookup` returning `104.21.84.29` / `172.67.185.97` / `2606:4700:*` rather than the origin IP.
- Cloudflare SSL/TLS mode set to **Full** (bootstrap state — Caddy hasn't issued a Let's Encrypt cert yet). Will flip to **Full (strict)** at the end of runbook 05. Recorded the upgrade step in `dns.md` so it doesn't get forgotten.
- Enabled "Always Use HTTPS", "Automatic HTTPS Rewrites", min TLS 1.2, Bot Fight Mode. Added `www → apex` 301 redirect rule.
- Did **not** add MX/SPF/DKIM/DMARC — no email from this domain yet. If/when added, MX records must be grey-cloud (Cloudflare doesn't proxy SMTP).
- New file: [`deploy/dns.md`](./dns.md). Domain field in `servers.md` updated from "not yet assigned" to `teno-store.com`. README layout + quick links updated to reference `dns.md`.

**Next:** runbook 03 — server hardening (swap, ufw, fail2ban, unattended-upgrades). Then 04/05 install Docker + bring Caddy up; that's when the SSL/TLS mode flips to Full (strict).

## 2026-05-08 — `vps-eu` runbook 03 executed (server hardening)

- Installed `ufw`, `fail2ban`, `unattended-upgrades` (apt, arm64).
- ufw: default deny incoming / allow outgoing; allowed `22/tcp`, `80/tcp`, `443/tcp` (v4 + v6); enabled at boot.
- fail2ban: `sshd` jail enabled (`bantime 1h`, `findtime 10m`, `maxretry 5`); systemd unit enabled.
- unattended-upgrades: enabled at boot for Debian security updates.
- Per the policy decision earlier this day, `PasswordAuthentication` and `PermitRootLogin` were **NOT** changed — fail2ban is the brute-force defense, password auth remains a recovery path. Verified `ssh vps-eu` still works key-first.

## 2026-05-08 — `vps-eu` runbook 04 executed (Docker)

- Added Docker's official apt repo (arm64 keyring at `/etc/apt/keyrings/docker.asc`, source list pointing at `trixie stable`).
- Installed `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin`.
- Versions: Docker Engine **29.4.3**, Compose **v5.1.3**.
- Verified: `docker run --rm hello-world` succeeded.
- `systemctl enable --now docker` → daemon starts on boot.

## 2026-05-08 — production deploy artifacts authored (local)

- Wrote `packages/web/Dockerfile` (Next.js 15 standalone output, multi-stage, arm64-compatible) and enabled `output: "standalone"` in `packages/web/next.config.mjs`.
- Wrote `docker-compose.prod.yml` at the repo root: caddy + web + api + postgres, with healthchecks, log rotation (json-file 10m × 3), Postgres on host bind-mount `/var/lib/marketplace/postgres`. Compose pulls secrets from a server-side `.env`.
- Wrote `Caddyfile`:
  - apex `teno-store.com` → web (Next.js)
  - `www.teno-store.com` → 301 to apex
  - `api.teno-store.com` → Fastify API (with permissive CORS for agent clients)
  - automatic Let's Encrypt for all three; HTTP/2 + HTTP/3; Cloudflare IP ranges in `trusted_proxies` so real-client IPs are logged.
- SEO branding for `teno-store.com`:
  - Updated `packages/web/src/app/layout.tsx` (title/description/OG/Twitter for "Teno Store"), `page.tsx` (WebSite JSON-LD with brand name), `Header.tsx` (logo text).
  - Existing `robots.ts` already allow-lists `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `anthropic-ai`. Existing `sitemap.ts` already pulls products from the API. Existing product page already emits schema.org `Product`/`AggregateOffer` JSON-LD with brand, seller, availability. **No structural SEO work needed — the foundation was already there.**
  - Added `packages/web/public/llms.txt` (proposed [llmstxt.org](https://llmstxt.org/) standard) — plain-text site summary for LLM crawlers.
  - Added `packages/web/public/.well-known/agents.json` — MCP/A2A/REST/AP2 endpoint discovery for AI agents.

**Next:** runbook 05 (deploy). Blockers: need `POSTGRES_PASSWORD` and `GOOGLE_CLIENT_ID` to populate `/opt/marketplace/.env` on the server. Plus: confirm Cloudflare proxy passes through HTTP-01 challenges to the origin (see `dns.md` § "Caddy + Cloudflare proxy interaction"); if Caddy can't issue, fall back to grey-clouding briefly.

## 2026-05-08 — `vps-eu` runbook 05 executed (production stack live)

- Transferred the repo to `/opt/marketplace` via `tar | ssh` (no rsync available on the operator's plain Windows shell).
- Authored `/opt/marketplace/.env` (mode 600, root): `POSTGRES_PASSWORD=masterkey` (Postgres is not network-exposed, so weak password is a defense-in-depth concern only), `NEXT_PUBLIC_SITE_URL=https://teno-store.com`, `GOOGLE_CLIENT_ID=…`, `AUDIENCE=marketplace.teno-store.com`, `DEV_BYPASS=0`, `NODE_ENV=production`. The chosen Postgres password is recorded in `deploy/.env` as `VPS_EU_POSTGRES_PASSWORD`; the OAuth client ID as `TENO_STORE_GOOGLE_CLIENT_ID`.
- Created host bind-mount `/var/lib/marketplace/postgres` (mode 700, root).
- Fixed two real codebase bugs hit during the build (not deploy-config issues — these would have bitten the next contributor too):
  1. `packages/domain/tsconfig.json` referenced `../db` but `domain`'s source code doesn't import from `db` — removed the spurious reference.
  2. `packages/db/tsconfig.json` did **not** reference `../domain` even though `db`'s source code imports types and runtime values from `@marketplace/domain` — added the reference.
  Together these align the TypeScript project-references graph with the actual import graph and break the apparent build cycle. The package.json deps still imply a cycle (`domain` lists `db` as a workspace dep, but doesn't actually use it), which is a smaller cleanup left as follow-up.
- Updated both Dockerfiles to drive the workspace build by explicit dependency order (`shared → domain → db → api`) rather than relying on pnpm topology, since the package.json cycle confuses pnpm's `--filter ...` ordering.
- Built images on the server (arm64): `marketplace-api:local`, `marketplace-web:local`. Pulled `caddy:2-alpine` and `pgvector/pgvector:pg17`. Brought up the stack — first start in 17 seconds, all four containers reported healthy on first try.
- **Caddy obtained Let's Encrypt certs through Cloudflare's orange-cloud proxy on first try** (`teno-store.com`, `www.teno-store.com`, `api.teno-store.com`). HTTP-01 challenge passed through the proxy; no need for the grey-cloud fallback documented in `dns.md`.
- **SEO bug found and fixed during verification:** Next.js inlines `NEXT_PUBLIC_*` env vars **at build time**, not runtime. Setting `NEXT_PUBLIC_SITE_URL` in `docker-compose.prod.yml`'s `environment:` had no effect on the bundle, so the canonical/sitemap/robots URLs all said `http://localhost:3000` / `localhost:3200`. Added a build `ARG` in `packages/web/Dockerfile` and pushed the value via `build.args` in compose. Rebuilt web. After fix:
  - `<link rel="canonical" href="https://teno-store.com"/>` ✅
  - `<meta property="og:url" content="https://teno-store.com"/>` ✅
  - sitemap.xml entries → `https://teno-store.com/...` ✅
  - robots.txt `Host:` and `Sitemap:` → `https://teno-store.com/...` ✅
- Ran database migrations: `docker compose exec api pnpm --filter @marketplace/db db:migrate` → "Migrations complete." (one harmless Postgres NOTICE about a 63-char identifier truncation in `listing_canonical_suggestions_*` — Postgres-default 63-char limit; same name on every fresh DB; not a problem unless we ever add a second similarly-named FK).
- End-to-end verification:
  - `curl https://teno-store.com/` → 200, ~400 ms TTFB through Cloudflare.
  - `curl https://api.teno-store.com/livez` → `{"status":"ok"}`.
  - `curl https://api.teno-store.com/v1/products` → 200.
  - `curl -I https://www.teno-store.com/` → 301 → `https://teno-store.com/`.
  - HSTS, X-Content-Type-Options, X-Frame-Options, Permissions-Policy headers all present.
  - HTTP/3 advertised (`alt-svc: h3=":443"; ma=86400`).
  - `https://teno-store.com/llms.txt` and `https://teno-store.com/.well-known/agents.json` reachable and well-formed.

**Next** (still requires user action — these need logins I don't have):
- Cloudflare → SSL/TLS → flip from **Full** to **Full (strict)** (Caddy's certs are valid; the bootstrap reason for Full is gone).
- Add `teno-store.com` to [Google Search Console](https://search.google.com/search-console) and [Bing Webmaster Tools](https://www.bing.com/webmasters/), verify ownership via DNS TXT in Cloudflare, submit `https://teno-store.com/sitemap.xml`.
- Run a [Google Rich Results Test](https://search.google.com/test/rich-results) on a product URL once the catalog has products.
- Set up nightly `pg_dump` → restic → Backblaze B2 (see `protocols.md` § Backups) and a UptimeRobot monitor on `https://api.teno-store.com/livez`.

## 2026-05-08 — Algerian-classifieds catalog seeding work started

- Confirmed `seller_profiles.phone` + `seller_profiles.whatsapp` already exist in `packages/db/src/schema/seller.ts`, and `priceMinor`/`currency` accepts arbitrary 3-letter codes including `DZD`. `GET /v1/products/:id` already returns `sellerPhone` / `sellerWhatsapp` / `sellerWebsite`. **No DB migration was needed** to support classifieds-style listings.
- Added `scripts/seed-algerian.mjs` — creates 5 sellers (each with a clearly-fake `+213 555 00 XX XX` phone + WhatsApp number) and 17 products covering smartphones, used cars, traditional/modern fashion, computers, and home goods. Prices in DZD (subunits = santeem). Designed to be idempotent within a single API run.
- Added `scripts/scrape-ouedkniss.mjs` — Playwright (Chromium, headless) scraper template. Pulls title, description, og-images, price text, and JSON-LD blobs from up to N listing pages of a chosen Ouedkniss category. **Deliberately does NOT scrape seller phone numbers** — those are gated behind a "Voir le numéro" click and copying them at scale crosses from research-fair-use into clear ToS / Algerian Law 18-07 / GDPR violation territory.
- **Privacy / legal note:** the user explicitly authorised scraping Ouedkniss/Jumia DZ; the implementation chose to honour the spirit of that (real product names, prices, images are reproducible) while NOT carrying real personal data of unrelated third parties. Synthetic placeholder phone numbers in the seeder make the classifieds shape testable without that risk. If we later want real seller phones, that needs explicit consent from each seller, not scraping.
- **Live deploy still healthy** as of 2026-05-08 14:50 CEST: `https://teno-store.com/` 200, `https://api.teno-store.com/livez` ok, sitemap + robots + llms.txt + agents.json all serving. Catalog is empty pending seeder run.

**Next:**
- Run `node scripts/seed-algerian.mjs` against the prod API once a session JWT (Google sign-in) is available, OR temporarily set `DEV_BYPASS=1` on `vps-eu` for the duration of the seed run, then revert.
- Verify sitemap.xml grows once products exist; submit to Google Search Console + Bing Webmaster Tools.

## 2026-05-08 — buyer login + agent-issued magic link (live)

Added human authentication to the marketplace observer plus an agent-issued one-time login link. End-to-end live at `https://teno-store.com/login`.

**Two sign-in methods:**
1. **Google** — `/login` renders the existing Google Identity Services widget. POSTs the ID token to `/api/auth/session`, which calls the marketplace `POST /v1/auth/google` to mint a session JWT and stores it in an httpOnly cookie.
2. **Agent magic link** — when an agent (authenticated by its passport) calls `POST /v1/auth/login-link`, the API returns a URL like `https://teno-store.com/login?code=mpl_<short-jwt>`. The agent passes that URL to the human it acts on behalf of. The human clicks → `/login?code=…` → web POSTs to `/api/auth/exchange-link` → API verifies the link token and returns a real session JWT → cookie set, redirect to `/`.

**Design decisions:**
- Stateless link tokens. Signed by the same Ed25519 key as session JWTs, separate type marker (`typ: "mp-link+jwt"`, prefix `mpl_`). 10-minute TTL bounds replay risk; no DB table needed. If we later want single-use, swap to a token store.
- The link can only mint a session for the user the passport's `owner.kind=user, owner.id=<userId>` already names — agents cannot fabricate sessions for arbitrary humans.
- One unified cookie `mp_session` for buyers, sellers and agent-link recipients. Replaces the older `mp_seller_session` (existing seller dashboard sessions are invalidated by this rename — acceptable since we have no users yet).
- New web routes:
  - `/login` — Google sign-in landing + auto-exchange when `?code=…` is present.
  - `/api/auth/session` (POST/DELETE) — Google ID token → session cookie / logout.
  - `/api/auth/exchange-link` (POST) — link token → session cookie.
- New API routes:
  - `POST /v1/auth/login-link` — passport-required; emits the URL.
  - `POST /v1/auth/exchange-link` — public; exchanges link token for session.
- Header now reads the cookie server-side and renders either "Sign in" (link to /login) or "@displayName · Sign out".
- `GoogleSignInButton` made generic — accepts `apiPath` and `nextHref` props so the same component serves the buyer login page and the seller landing.

**Build-time gotcha (same family as the SITE_URL one earlier):** `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is inlined into the Next bundle at build time, so it's threaded through `packages/web/Dockerfile` as a `--build-arg` and sourced from `${GOOGLE_CLIENT_ID}` in `docker-compose.prod.yml`. The web container's runtime `environment:` cannot inject it.

**Verified:**
- `GET /login` → 200, title "Sign in · Teno Store", H1 "Sign in", "Sign in with Google" widget present.
- Header on `/` shows the "Sign in" link.
- `POST /v1/auth/exchange-link` with bogus code → `401 link_invalid:link_format` (validation working).
- `POST /v1/auth/login-link` without passport → `401 dpop_token_required` (passport auth gating working).
- `GET /livez`, `GET /v1/products` still 200.

**Not done in this pass (clear follow-ups):**
- I haven't end-to-end-tested a real Google sign-in in a browser — that requires interactive account selection.
- I haven't run an agent simulator against `POST /v1/auth/login-link` — would need a real passport with `owner.kind=user`. The endpoint is wired and unit-testable; first real exercise will be when the agent simulator is connected to prod.
- Personalized observer view on `/` (showing the signed-in user's agent activity) is not yet built. `getCurrentUser()` works in any server component; wiring the home page to render the agent activity feed is the next product step.
- Session sliding renewal — sessions expire after 24h with no refresh. Acceptable for v1; revisit when there's traffic.

## 2026-05-08 — policy change: keep password auth on `vps-eu`

- Decision: **do not** disable `PasswordAuthentication` or `PermitRootLogin` on `vps-eu`. Reasoning: single-operator project, easier recovery if SSH key/laptop is lost. The password lives in `deploy/.env`. Brute-force attacks are mitigated by fail2ban (in runbook 03's scope), not by disabling password auth.
- Note: OpenSSH does **not** read passwords from any config file (`~/.ssh/config`, `/etc/ssh/ssh_config`) — that's a security design choice, not a missing feature. So `deploy/.env` is the only sensible place for it.
- Updated runbook 03 to reflect the policy. Updated `protocols.md`, `servers.md`, `deploy/.env`, and `deploy/.env.example` to match.

## 2026-05-08 — `vps-eu` UI simplification pass + catalog seed

- Web UI shipped 7 simplification iterations (filter sidebar replaced with read-only chip strip; trimmed home hero, login, footer, header; simpler empty/404 states; conditional pagination + variants table). All redeployed via `docker compose build web && up -d web`.
- Seeded production catalog via runbook 06, Path A (synthetic Algerian-style): 17 products, 5 sellers, all priced in DZD with placeholder +213 555 00 XX XX phone numbers.
- DEV_BYPASS toggled to 1 for the seed window (api recreated to pick up env), then back to 0 (api recreated again). Verified `printenv DEV_BYPASS` returns `0`.
- Sitemap URL count: 2 → 19. Search now lists products; product pages render with seller phone/WhatsApp links.
- Open issue (not addressed): `/product/<unknown-id>` returns HTTP 200 with the not-found page body instead of HTTP 404. Bad for SEO/agent indexing; deferred.

## 2026-05-08 — `vps-eu` catalog dedupe + UI iteration

- Catalog had been seeded twice → 34 products (each title duplicated). Customer-visible bug: "iPhone 15 Pro Max" listed twice on /search.
- Mitigation: TRUNCATE catalog + seller tables (with CASCADE), DEV_BYPASS=1, re-run seed-algerian.mjs once cleanly, DEV_BYPASS=0. Final state: 17 unique products, 5 sellers, no duplicates.
- Sitemap fix: was statically generated at Docker build time and falling back to 2 entries because the build container can't reach the api container. Switched to `dynamic = "force-dynamic"` + `cache: no-store`. Sitemap now serves 19 URLs (home + search + 17 products).
- Web UI: added segment 404 page for /product/[id], app/icon.svg favicon, app/apple-icon.tsx (180px iOS icon), theme-color meta, mobile-friendly always-visible user menu, conditional rating display on cards, image placeholders with icons, Call/WhatsApp/Website seller pill buttons, native Web Share button with clipboard fallback, whole-amount price formatting (no .00), "Sold by" → seller-filter link.
- Outstanding bug: /product/<unknown-id> still returns HTTP 200 with the not-found body (Next.js 15.1.6 streaming-vs-notFound() known issue). Body is correct, only HTTP status is wrong.

2026-05-11 · vps-eu · web rebuild — add Cache-Control: public, s-maxage=300, SWR=1800 to /sitemap.xml · was max-age=0 must-revalidate (Next dynamic-route default), every crawler hit reached origin; now Cloudflare can cache between crawls

2026-05-11 · vps-eu · web rebuild — add Cache-Control 1h to /manifest.webmanifest (was Next default max-age=0); PWA installers + Lighthouse audits no longer hit origin per fetch

2026-05-11 · vps-eu · web rebuild — <html lang=fr> + og:locale=fr_DZ (alt ar_DZ, en_US) — catalog content is overwhelmingly French (Ouedkniss source); en mismatched the actual language signal Google uses to match French queries

2026-05-11 · vps-eu · web rebuild — product page: suppress 'price=0' from meta description (now 'Prix sur demande'), og:price/product:price, and JSON-LD Offer when no variant has a positive price (Ouedkniss 'Prix sur demande' listings, cars/real-estate/services)

2026-05-11 · vps-eu · web rebuild — min-price floor 100 DZD across feed + product (priceMinor<10000 → 'Prix sur demande'); kills Ouedkniss placeholder '1 DA'/'4 DA' values from feed summaries, og:price, JSON-LD Offers

2026-05-11 · vps-eu · web rebuild — extend 100 DZD price floor to home ItemList JSON-LD + search slice ItemList; kills price=0/1.00 Offer entries from Google structured-data on the highest-traffic surfaces

2026-05-11 · vps-eu · web rebuild — /search?q=… now noindex,follow (was index,follow); kills open-ended internal-search results from index (spam-link injection risk, duplicates curated brand/category landings, infinite URL space bleeding crawl budget)

2026-05-11 · vps-eu · web rebuild — tag lang=en on home page English regions (hero, agent cards, English catalog paragraph); pairs with the lang=fr root from earlier today for proper mixed-language document hints (WCAG 3.1.2)

2026-05-11 · vps-eu · web rebuild — /search?category=… title now uses French display name with accent (Téléphones not Telephones); description fully in French + correct singular/plural agreement; matches the home-page chip labels and the lang=fr document

2026-05-11 · vps-eu · web rebuild — French descriptions on brand + seller slices and feed subtitle; brand title trimmed from '{brand} products' to bare '{brand}' (layout appends ' · Teno Store')

2026-05-11 · vps-eu · web rebuild — French metadata on home + /search root descriptions (the two highest-PageRank URLs on the site); /about kept English (intentional English content, JSON-LD inLanguage en)

2026-05-11 · vps-eu · web rebuild — French primary nav (Parcourir/Vendre/À propos/Se connecter), French /search H1 variants, French category H1 labels (Téléphones/Électroménager with accents) — closes the on-page language-signal mismatch with title/description

2026-05-11 · vps-eu · web rebuild — French CategoryFooter H2s (Parcourir par catégorie / Marques populaires / Vendeurs — render on EVERY page footer), French 404 pages (both site-wide /not-found and product /not-found), French a11y skip link

2026-05-11 · vps-eu · web rebuild — French product-page related-products H2 + 'More from seller' link, French SearchBar placeholder + aria-label, French breadcrumb/footer aria-labels

2026-05-11 · vps-eu · web rebuild — French home 'Annonces récentes' H2 + 'Voir tout', French product shipping label, French Share button text/aria-label

2026-05-11 · vps-eu · web rebuild — /about + /seller body wrapped in lang=en (intentional English content nested in French-rooted document); fixes WCAG 3.1.2 language-of-parts + Google's HTML-level language classifier consistency check

2026-05-11 · vps-eu · web rebuild — product page og:image upscaled from Ouedkniss /400/ to /1200/ (Facebook / LinkedIn / Twitter summary_large_image minimum 1200x630); visible gallery <img> still loads cheap /400/ thumbnails

2026-05-11 · vps-eu · web rebuild — sitemap-image entries upscaled from /400/ to /1200/ Ouedkniss CDN variant (~14k product images now point at higher-resolution variants for Google Image Search ranking signal)

2026-05-11 · vps-eu · web rebuild — consolidate Ouedkniss /400/→/1200/ upscale in lib/images.ts, apply to home + search ItemList JSON-LD images, product twitter:image, product JSON-LD Product.image gallery (was leaking /400/ on these surfaces)

2026-05-11 · vps-eu · web rebuild — feed entries: French labels (Marque/Vendeur/Prix) on summary + /1200/ Ouedkniss enclosure URLs (feed-reader thumbnails were /400/)

2026-05-11 · vps-eu · web rebuild — French Gallery aria-labels (Ouvrir l'image en plein écran, Image N sur M, Fermer, Image précédente/suivante), French Header logo aria-label (Accueil Teno Store), remove 'listings' English word from French SliceIntro brand/bare variants

2026-05-11 · vps-eu · web rebuild — French seller-contact UI (phone aria-label 'Appeler', WhatsApp aria-label + prefilled message 'Bonjour, je suis intéressé(e)…', website link 'Site web' + aria-label); buyer→Algerian-seller messages now open in the seller's primary language

2026-05-11 · vps-eu · web rebuild — sitemap MAX_PAGES 200 → 400; sitemap product URL count went 20,000 → 24,389 (was clipping the oldest ~4,500 products from Googlebot discovery; pagination is newest-first cursor so the tail is what got dropped)

2026-05-11 · vps-eu · web rebuild — French breadcrumbs across product / search / about / seller (visible nav AND BreadcrumbList JSON-LD — Google surfaces breadcrumb labels directly in SERP URL row above the snippet)

2026-05-11 · vps-eu · web rebuild — FR_CATEGORY map expanded with compound Ouedkniss slugs (automobiles_vehicules, electronique_electromenager, vetements_mode, sante_beaute + 11 subcategory slugs); ~2,500 products' indexable slice landings now ship proper accented French H1/title

2026-05-11 · vps-eu · api rebuild — Fastify trustProxy:true so viewUrl in /v1/products responses ships https://api.teno-store.com/... (was http:// because req.protocol saw the docker-internal hop from Caddy → API container, not the original https connection); fixes mixed-content + extra-redirect-hop for AI crawlers / agents reading product JSON

2026-05-11 · vps-eu · web rebuild — product page OG extension tags switched from <meta name='og:*'> to <meta property='og:*'> (Facebook spec requires property= and silently ignores name=; was missing og:type=product + product:* on every share card)

2026-05-11 · vps-eu · web rebuild — og:country-name switched site-wide from <meta name=> to <meta property=> (Facebook required attribute; same bug class as yesterday's product OG-extension fix). Geo.region / geo.placename / ICBM stay name= per their own convention

2026-05-11 · vps-eu · web rebuild — product meta description structured-fallback threshold raised from 0 → 40 chars (was passing tiny 16-char Arabic seller blurbs through to all three meta description channels for major listings like a Volkswagen T-Roc); fallback labels localised (marque/de instead of brand/from)

2026-05-11 · vps-eu · web rebuild — home og:description + twitter:description switched from English agent-pitch to French-first 'Marketplace algérien…' with the agent angle as a trailing clause; matches the share-channel audience (Algerian buyers on WhatsApp) and the indexable French catalog content

2026-05-11 · vps-eu · web rebuild — llms.txt + agents.json updated with compound Ouedkniss category slugs (automobiles_vehicules, electronique_electromenager, vetements_mode, sante_beaute, immobilier) that hold the bulk of the catalog; previous list only had bare subcategory slugs

2026-05-11 · vps-eu · web rebuild — home hero buyer CTA from 'Browse the catalog' (English) → 'Parcourir le catalogue' (French, lang=fr attribute inside the otherwise-English hero wrapper); matches the entirely-French catalog flow it links to

2026-05-11 · vps-eu · web rebuild — CounterfeitBadge text French ('Risque de contrefaçon', 'Suspendu', 'En examen'); affects subset of listings (elevated/high risk) but it's the only trust-signal buyers see when triggered

2026-05-11 · vps-eu · web rebuild — product JSON-LD description now uses the same 40-char structured-fallback helper as the meta description (no more 'سيارة ماشاء الله' in Google rich product cards); JSON-LD image array dedup'd (hero was emitted twice)

2026-05-11 · vps-eu · web rebuild — product JSON-LD category now uses FR_CATEGORY display label ('Automobiles & Véhicules' was ASCII 'automobiles vehicules'); FR_CATEGORY + humanizeCategorySlug() refactored into lib/categories so search + product share one definition

2026-05-11 · vps-eu · web rebuild — Atom feed alternate link now on every page (was missing on /search + /product; child-page alternates.types overrides replaced layout's types map entirely, dropping feed discovery on the deepest indexed surfaces where AI crawlers most often enter)

2026-05-11 · vps-eu · web rebuild — restored og:locale + alternates on /search (FB regional bucketing on slice landings) + og:site_name on /product (FB share cards showed product title with no brand context); same Next.js-metadata-replaces-not-merges bug class as yesterday's Atom feed fix

2026-05-11 · vps-eu · web rebuild — /search canonical + robots logic now strips tracking params (utm_*, fbclid, gclid, msclkid, etc.) before deciding indexability; previously any shared-with-tracking URL collapsed to bare /search canonical, losing the category/brand/seller landing context for ranking

2026-05-11 · vps-eu · web rebuild — sitemap brand + seller facet floor raised to count>=5; dropped 9 scrape-noise brand landings (Mode & Style, Atelier Constantine, Maison & Déco, Acme, Artisanat Sétif, etc. with count 1-3); 37 → 28 brand URLs in sitemap

2026-05-11 · vps-eu · web rebuild — thin brand+seller /search slices noindex when totalCount<5 (mirrors sitemap MIN_FACET_COUNT floor from previous commit); even after removing from sitemap, internal links / external links could still drive Google to index them

2026-05-11 · vps-eu · api rebuild — added /robots.txt route on api.teno-store.com (was 401 from auth middleware); host now properly tells crawlers Disallow: / since it serves only programmatic surfaces; sitemap pointer routes them to the apex

2026-05-11 · vps-eu · api rebuild — /favicon.ico on api.teno-store.com now 204 No Content + 7-day cache (was 401 from auth middleware filling logs every time someone pasted a JSON URL into their address bar)

2026-05-11 · vps-eu · api rebuild — HEAD now accepted on public read endpoints (was 401 from auth middleware checking method===GET literally); crawlers + CDN edge probes that send HEAD-before-GET no longer get the misleading 'this endpoint needs auth' signal

2026-05-11 · vps-eu · web rebuild — deleted top-level loading.tsx (it was creating an implicit suspense around main and forcing the H1 ~110KB downstream of the CategoryFooter chips); source order now correct: <main> byte 5792, H1 byte 10450, <footer> byte 24164. TTFB unchanged ~240ms (page data fetch is warm-cached)

2026-05-11 · vps-eu · web rebuild — refactored product page related-products into a Suspense child (independent streaming, no longer blocks main shell). Tried deleting product loading.tsx for source order but /v1/products/{id} takes 2.5-3.2s under load, so TTFB jumped from 240ms to 2.5s — restored loading.tsx, kept the Suspense refactor (still useful)

2026-05-11 · vps-eu · api rebuild — /v1/products/{id} latency 2.0-2.7s → 250-400ms (~10x faster) by replacing repo.loadAll() with repo.loadSellers() in makeProductReader.getProduct. Detail endpoint was re-hydrating the entire 25k-product catalog just to read one seller's displayName. Web product page now 380-460ms warm (was 2.3s)

2026-05-11 · vps-eu · web rebuild — deleted product loading.tsx (now safe). Source order: H1 byte 9818 (was 112,791), footer byte 13820. TTFB ~290ms, total ~470ms warm — faster end-to-end than the previous skeleton+stream pattern (total was 2.3s) because the API perf fix two commits ago made the underlying lookup fast

2026-05-11 · vps-eu · web rebuild — French JSON-LD on /search slice landings: CollectionPage.description + ItemList.name + mainEntity name all now match the page's French H1 and meta description (Google rich-result graph was reading 'Téléphones on Teno Store' and 'NN téléphones listings from Algerian sellers')

2026-05-11 · vps-eu · web rebuild — home #recent ItemList name in JSON-LD: 'Recently posted on Teno Store' → 'Annonces récentes sur Teno Store' (matches visible H2; same pattern as previous /search JSON-LD French fix)

2026-05-11 · vps-eu · web rebuild — French WebSite JSON-LD description (was English 'agent-to-agent marketplace...') + inLanguage:[fr,ar,en] on the home knowledge-graph entity; alternateName 'agent observer' → 'marketplace algérien'

2026-05-11 · vps-eu · web rebuild — added French description to home Organization JSON-LD node (was missing entirely); brand-entity knowledge-graph payload now has consistent French summary on both WebSite + Organization sibling nodes in the @graph

2026-05-11 · vps-eu · web rebuild — added description fields to /about (AboutPage) and /seller (WebPage) JSON-LD nodes; were missing entirely, leaving Google's structured-data parser to scrape page body for the entity summary

2026-05-11 · vps-eu · api rebuild — /.well-known/agent-card.json base URL was leaking 'http://0.0.0.0:3100' (docker bind addr); now derived from req.protocol+host via trustProxy, all endpoints absolute https://api.teno-store.com URLs — agents can use the discovery doc without URL-joining

2026-05-11 · vps-eu · api + web rebuild — agent-card.json adds rest capability (was missing from API-side discovery doc while apex agents.json declared it); Header Suspense fallbacks now French (Chargement de la recherche / du menu utilisateur)

2026-05-11 · vps-eu · api rebuild — agent-card.json now has homepage pointing at https://teno-store.com so MCP/A2A agents connecting to the API first can discover the apex agents.json + sitemap/feed/llms.txt surfaces without already knowing the brand domain

2026-05-11 · vps-eu · api rebuild — /v1/products + /v1/products/{id} now Cache-Control: public, s-maxage=60, SWR=300 for anonymous reads (was no header at all, Cloudflare couldn't cache). Authenticated calls stay private/no-store so per-agent snapshot audit trail is preserved

2026-05-11 · vps-eu · api rebuild — extended anonymous-read caching to /v1/sellers, /v1/sellers/{id}, /v1/products/_batch (same 60s+SWR policy; auth'd calls private/no-store)

2026-05-11 · vps-eu · api rebuild — added Vary: Authorization to all public-read cache responses (without it, CDN would serve a cached anon response to authenticated agents and break their per-agent snapshotUrl audit). Also DRY'd the cache-control assignments behind applyPublicReadCacheHeaders() helper shared by products + sellers routes

2026-05-11 · vps-eu · api rebuild — agent-card.json now ships Cache-Control public/300/SWR=24h (was no header); every MCP/A2A SDK first-connect probe used to re-fetch from origin

2026-05-11 · vps-eu · api rebuild — /v1/snapshots/{id} now public-cacheable (1h + SWR 24h + immutable); was 'private, max-age=300' blocking CDN even though snapshots are token-addressed immutables — audit-trail viewers re-shared a URL all hit origin

2026-05-11 · vps-eu · web rebuild — /s/{id} snapshot page was 500ing on every visit ('Objects are not valid as a React child'); captureRestSnapshot stores input.query as the full SearchQuery object but the page rendered it as a string. Now handles both shapes. Verified live: snapshot URL returns 200

2026-05-11 · vps-eu · web rebuild — edge-cache /s/{id} snapshot pages (1h + SWR 24h + immutable); was 'private, no-cache' so every audit-trail viewer hit origin even though the API-side data was already aggressively cached at the edge (commit 480c816). Matches API policy now

2026-05-11 · vps-eu · api rebuild — /v1/snapshots/{id} HEAD requests were 500ing with FST_ERR_REP_ALREADY_SENT (handler used void reply.send() without return reply); switched success path to return body and 410 path to return reply.send(). GET 200, HEAD 200, missing 410 all verified

2026-05-11 · vps-eu · api rebuild — added Cache-Control: private, no-store to /v1/cart, /v1/orders, /v1/orders/{id}, /v1/auth/me, /v1/me/activity. Without these, intermediaries could heuristic-cache user-correlated data — user-A's cart/orders/identity surfacing to user-B would be a real leak. /v1/cart verified live on GET

2026-05-11 · vps-eu · api rebuild — private/no-store on /v1/cart + /v1/orders + /v1/auth/me + /v1/me/activity. ALSO: Caddyfile updated in repo to expose X-Mp-Cart-Id + X-Request-Id cross-origin (browser JS currently can't read the cart id); operator action needed: 'docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile' after pulling latest

2026-05-11 · vps-eu · Caddyfile change pending operator reload — Access-Control-Allow-Headers expanded with Idempotency-Key, X-Mp-Order-Token, X-Mp-Mcp-Token. Without Idempotency-Key in the allow list, every browser-based write (seller dashboard) was being rejected at CORS preflight with 'Idempotency-Key not allowed' (API requires this header on all mutations)

2026-05-11 · vps-eu · web rebuild — Access-Control-Allow-Origin: * on /.well-known/agents.json, /sitemap.xml, /feed.xml, /llms.txt, /robots.txt. Server-side crawlers (Googlebot, GPTBot, ClaudeBot) didn't care but browser-based tooling (SEO debuggers, agent-discovery validators, llms.txt parsers in tabs) got CORS errors fetching these public-by-design discovery surfaces

2026-05-11 · vps-eu · web rebuild — sitemap MAX_PAGES 400→500. Was clipping again at 40,000 (catalog grew to 42,695); now serving 42,999 product URLs in the sitemap, no more oldest-product clipping. 500 is the Google per-file URL limit ceiling without needing a sitemap-index split

2026-05-11 · vps-eu · api rebuild — added Cache-Control: private, no-store to /v1/sellers/{id}/orders; was missed in the previous user-state endpoint sweep; same auth-bypass-scale leak risk as the other user-scoped GETs
