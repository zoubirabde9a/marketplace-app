import type { MetadataRoute } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

const API_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.MARKETPLACE_API_URL ??
  "http://127.0.0.1:3100"
).replace(/\/$/, "");

// Cache the sitemap render for 5 minutes. The scrape-and-seed loop adds new
// products continuously, but Googlebot polls /sitemap.xml every few hours,
// so 5-min freshness is more than the freshness Google can act on, and it
// drops sitemap TTFB from ~2s to ~50ms (Cloudflare cf-cache-status flips
// DYNAMIC -> HIT once warmed). `dynamic` is left as the Next default so
// revalidate actually applies.
export const revalidate = 300;

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

async function fetchAllProducts(): Promise<SitemapHarvest> {
  const products: SitemapProduct[] = [];
  const brands: string[] = [];
  const sellerIds: string[] = [];
  const categories: string[] = [];
  let cursor: string | null = null;
  // Cap pagination so a misbehaving API can't cause an unbounded sitemap build.
  const MAX_PAGES = 50;
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
    if (page === 0) {
      for (const b of body.facets?.brands ?? []) {
        if (b.value && b.count > 0 && !brands.includes(b.value)) brands.push(b.value);
      }
      for (const s of body.facets?.sellers ?? []) {
        const id = s.sellerId ?? s.value;
        if (id && s.count > 0 && !sellerIds.includes(id)) sellerIds.push(id);
      }
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
      url: `${SITE_URL}/`,
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
      ...(p.heroImageUrl ? { images: [p.heroImageUrl] } : {}),
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
