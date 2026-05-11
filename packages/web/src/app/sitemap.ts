import type { MetadataRoute } from "next";
import { upscaleOuedknissForCrawler } from "@/lib/images";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

const API_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.MARKETPLACE_API_URL ??
  "http://127.0.0.1:3100"
).replace(/\/$/, "");

// Production probe (iter-29) showed every /sitemap.xml hit was rebuilding
// from scratch — 85-125s per request, Googlebot timeout territory. Next's
// route-level `revalidate` was being defeated by `cache: "no-store"` on
// the harvest fetches (which we can't drop — the iter-16 regression locked
// an empty payload in the Next data cache when we tried). Using a plain
// module-level in-memory cache around the harvest sidesteps Next's
// caching layer entirely: harvest runs once per TTL, every other request
// returns the cached payload synchronously.
//
// Single web container = single cache. 30-min TTL is well inside Googlebot's
// crawl cadence (hourly at most) and the catalog grows ~50/iter.
export const revalidate = 300;
const HARVEST_TTL_MS = 30 * 60 * 1000;
let cachedHarvest: { data: SitemapHarvest; ts: number } | null = null;
let inFlight: Promise<SitemapHarvest> | null = null;

// Test hook — vitest's beforeEach can call this to clear the module-level
// cache between cases. Production never calls it; the cache is bypassed
// purely by TTL.
export function __resetSitemapCacheForTests(): void {
  cachedHarvest = null;
  inFlight = null;
}


interface SitemapProductHit {
  productId: string;
  postedAt?: string | null;
  updatedAt?: string | null;
  heroImageUrl?: string | null;
}

interface SitemapProduct {
  productId: string;
  lastModified: Date;
  heroImageUrl?: string;
}

interface SitemapHarvest {
  products: SitemapProduct[];
  brands: string[];
  sellerIds: string[];
  categories: string[];
}

// SWR (stale-while-revalidate) window: serve stale-but-cached harvest
// up to STALE_MAX_MS past the fresh window, while a background refresh
// runs. iter probe found two of three /sitemap.xml hits timing out at
// 30s during a cold rebuild — Googlebot would back off. With SWR the
// requesters never block on rebuild after the very first warm-up:
// fresh < 30 min → return cached
// 30 min < age < 4 h → return cached, kick off async refresh
// > 4 h or no cache → block on rebuild (rare, only at container start
//   or after a long idle).
const STALE_MAX_MS = 4 * 60 * 60 * 1000;

async function fetchAllProducts(): Promise<SitemapHarvest> {
  const now = Date.now();
  if (cachedHarvest) {
    const age = now - cachedHarvest.ts;
    if (age < HARVEST_TTL_MS) {
      // Fresh — serve cache.
      return cachedHarvest.data;
    }
    if (age < STALE_MAX_MS) {
      // Stale-but-acceptable — serve cache AND kick off background refresh.
      // Don't await it; the current request returns immediately. Subsequent
      // requests during the in-flight rebuild also see the cached value.
      if (!inFlight) {
        inFlight = (async () => {
          try {
            const data = await fetchAllProductsUncached();
            if (data.products.length > 0) {
              cachedHarvest = { data, ts: Date.now() };
            } else {
              console.error("[sitemap] background refresh returned 0 products — keeping stale");
            }
            return data;
          } catch (err) {
            console.error("[sitemap] background refresh failed:", err);
            return cachedHarvest!.data;
          } finally {
            inFlight = null;
          }
        })();
      }
      return cachedHarvest.data;
    }
  }
  // No cache, or too stale to serve — block on rebuild. Coalesce
  // concurrent callers so we don't fan out to N parallel harvests.
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const data = await fetchAllProductsUncached();
      // Refuse to cache an obviously-broken harvest. iter-16 + iter-29 both
      // showed empty product lists (API cold at container start, transient
      // network blip) getting locked into the cache for the full TTL,
      // shrinking the live sitemap to 4 static entries. Steady-state
      // catalog has thousands; if we got zero, retry on next request
      // rather than serve a broken sitemap for 30 minutes.
      if (data.products.length === 0) {
        console.error(
          "[sitemap] harvest returned 0 products — not caching, will retry next request",
        );
        return data;
      }
      cachedHarvest = { data, ts: Date.now() };
      return data;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function fetchAllProductsUncached(): Promise<SitemapHarvest> {
  const products: SitemapProduct[] = [];
  const brands: string[] = [];
  const sellerIds: string[] = [];
  const categories: string[] = [];
  let cursor: string | null = null;
  // Cap pagination so a misbehaving API can't cause an unbounded sitemap build.
  // Live probe 2026-05-11T18:* found the previous 400 × 100 = 40,000 cap was
  // again clipping ~2,700 of the OLDEST products (catalog grew to 42,695
  // since the last bump). Pagination is newest-first cursor-based so the
  // clipped tail is the most-stale inventory. Bumped to 500 pages = 50,000
  // product headroom — also the per-file URL limit Google enforces on
  // sitemaps, so beyond this we'd need to split into a sitemap index
  // anyway. Walks in seconds thanks to the module-level harvest cache
  // (30-min TTL + SWR to 4 h). Capped at 50,000 by Google's hard limit.
  const MAX_PAGES = 500;
  const LIMIT = 100;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams();
    params.set("limit", String(LIMIT));
    if (cursor) params.set("cursor", cursor);
    const url = `${API_URL}/v1/products?${params.toString()}`;
    let res: Response;
    try {
      // cache:"no-store" so each ISR rebuild sees the latest catalog state.
      // Route-level `revalidate = 300` is what actually caches the rendered
      // sitemap response for 5 min; the per-fetch policy here only controls
      // what happens during a rebuild. Earlier we tried next:{revalidate:300}
      // here too — it caused production sitemap to silently shrink to 4
      // static entries (~722 bytes), losing all 4,000 product/brand/seller/
      // category URLs. Likely a stale empty payload getting locked into the
      // data cache after one bad cold render. no-store sidesteps that
      // entirely: the rebuild fetches fresh, the rendered output is what
      // gets cached.
      res = await fetch(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
    } catch (err) {
      // Surface to server logs so a future rebuild failure isn't silent.
      // Outer catch in sitemap() turned this into the empty-sitemap
      // regression we just fixed.
      console.error("[sitemap] harvest fetch failed:", err);
      break;
    }
    if (!res.ok) break;
    let body: {
      data?: SitemapProductHit[];
      pagination?: { cursor: string | null };
      facets?: {
        brands?: Array<{ value: string; count: number }>;
        sellers?: Array<{ sellerId?: string; value?: string; count: number }>;
        categories?: Array<{ value: string; count: number }>;
      };
    };
    try {
      body = await res.json();
    } catch {
      break;
    }
    for (const hit of body.data ?? []) {
      if (!hit?.productId) continue;
      const ts = hit.updatedAt ?? hit.postedAt ?? null;
      const lastModified = ts ? new Date(ts) : new Date();
      products.push({
        productId: hit.productId,
        lastModified,
        ...(hit.heroImageUrl ? { heroImageUrl: hit.heroImageUrl } : {}),
      });
    }
    // Brand facets are global (not per-page), so capture from the first page only.
    // Apply a min-count floor on brands + sellers: live data has scrape-source
    // noise where category-like or seller-like strings end up tagged as
    // "brands" with count=1 (e.g. 'Mode & Style', 'Atelier Constantine',
    // 'Maison & Déco', 'Acme'). Indexing those as their own thin brand
    // landings (1-2 products each) hurts site-quality signals. The compound
    // categories and high-volume brands all have count ≥5; this floor cleans
    // the long tail without dropping anything substantive.
    if (page === 0) {
      const MIN_FACET_COUNT = 5;
      for (const b of body.facets?.brands ?? []) {
        if (b.value && b.count >= MIN_FACET_COUNT && !brands.includes(b.value)) brands.push(b.value);
      }
      for (const s of body.facets?.sellers ?? []) {
        const id = s.sellerId ?? s.value;
        if (id && s.count >= MIN_FACET_COUNT && !sellerIds.includes(id)) sellerIds.push(id);
      }
      // Categories aren't noisy (closed taxonomy); keep the >0 threshold.
      for (const c of body.facets?.categories ?? []) {
        if (c.value && c.count > 0 && !categories.includes(c.value)) categories.push(c.value);
      }
    }
    cursor = body.pagination?.cursor ?? null;
    if (!cursor) break;
  }

  return { products, brands, sellerIds, categories };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    {
      // No trailing slash — match what the home page actually emits as
      // canonical. Layout sets canonical to SITE_URL (no slash), so the
      // sitemap entry must match or we send Google two slightly-different
      // URLs to dedupe.
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/search`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/seller`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];

  let productEntries: MetadataRoute.Sitemap = [];
  let brandEntries: MetadataRoute.Sitemap = [];
  let sellerEntries: MetadataRoute.Sitemap = [];
  let categoryEntries: MetadataRoute.Sitemap = [];
  try {
    const { products, brands, sellerIds, categories } = await fetchAllProducts();
    productEntries = products.map((p) => ({
      url: `${SITE_URL}/product/${encodeURIComponent(p.productId)}`,
      lastModified: Number.isFinite(p.lastModified.getTime()) ? p.lastModified : now,
      changeFrequency: "daily",
      priority: 0.7,
      // Surface the hero image to Google Image Search via the
      // sitemap-image extension. With ~3k+ catalog rows, image search
      // is a non-trivial discovery surface that costs nothing to expose.
      // API surfaces heroImageUrl at the /400/ Ouedkniss CDN size — too
      // small for Image Search to rank well. The CDN supports a /1200/
      // variant on the same path; sitemap entries are crawler-only so
      // weight doesn't matter, and the larger asset is indexable for
      // higher-quality image-result eligibility. See product page
      // upscaleForShare for the same transform applied to og:image.
      ...(p.heroImageUrl
        ? { images: [upscaleOuedknissForCrawler(p.heroImageUrl)] }
        : {}),
    }));
    // Brand-only landing pages (/search?brand=Apple) are indexable per
    // search/page.tsx's canonical logic — give Google a direct seed for each.
    brandEntries = brands.map((b) => ({
      url: `${SITE_URL}/search?brand=${encodeURIComponent(b)}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.6,
    }));
    sellerEntries = sellerIds.map((id) => ({
      url: `${SITE_URL}/search?sellerId=${encodeURIComponent(id)}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.6,
    }));
    // Category-only landings (`/search?category=telephones`) are now
    // canonical-self + indexable via search/page.tsx; surface them so Google
    // sees them as legitimate destinations rather than discovering them by
    // following links.
    categoryEntries = categories.map((c) => ({
      url: `${SITE_URL}/search?category=${encodeURIComponent(c)}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    }));
  } catch (err) {
    // API unreachable — fall back to static-only sitemap. Log so we see it
    // in container logs; this exact catch silently swallowed an error in
    // iter-11 → iter-15 and shrank the prod sitemap to 4 static entries.
    console.error("[sitemap] product/facet harvest failed:", err);
    productEntries = [];
    brandEntries = [];
    sellerEntries = [];
    categoryEntries = [];
  }

  return [...staticEntries, ...categoryEntries, ...brandEntries, ...sellerEntries, ...productEntries];
}
