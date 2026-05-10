import type { MetadataRoute } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

const API_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.MARKETPLACE_API_URL ??
  "http://127.0.0.1:3100"
).replace(/\/$/, "");

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
}

async function fetchAllProducts(): Promise<SitemapHarvest> {
  const products: SitemapProduct[] = [];
  const brands: string[] = [];
  const sellerIds: string[] = [];
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
      res = await fetch(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
    } catch {
      break;
    }
    if (!res.ok) break;
    let body: {
      data?: SitemapProductHit[];
      pagination?: { cursor: string | null };
      facets?: {
        brands?: Array<{ value: string; count: number }>;
        sellers?: Array<{ sellerId?: string; value?: string; count: number }>;
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
    }
    cursor = body.pagination?.cursor ?? null;
    if (!cursor) break;
  }

  return { products, brands, sellerIds };
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
  try {
    const { products, brands, sellerIds } = await fetchAllProducts();
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
  } catch {
    // API unreachable — fall back to static-only sitemap.
    productEntries = [];
    brandEntries = [];
    sellerEntries = [];
  }

  return [...staticEntries, ...brandEntries, ...sellerEntries, ...productEntries];
}
