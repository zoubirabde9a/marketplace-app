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
}

interface SitemapProduct {
  productId: string;
  lastModified: Date;
}

async function fetchAllProducts(): Promise<SitemapProduct[]> {
  const products: SitemapProduct[] = [];
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
    let body: { data?: SitemapProductHit[]; pagination?: { cursor: string | null } };
    try {
      body = await res.json();
    } catch {
      break;
    }
    for (const hit of body.data ?? []) {
      if (!hit?.productId) continue;
      const ts = hit.updatedAt ?? hit.postedAt ?? null;
      const lastModified = ts ? new Date(ts) : new Date();
      products.push({ productId: hit.productId, lastModified });
    }
    cursor = body.pagination?.cursor ?? null;
    if (!cursor) break;
  }

  return products;
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
  ];

  let productEntries: MetadataRoute.Sitemap = [];
  try {
    const products = await fetchAllProducts();
    productEntries = products.map((p) => ({
      url: `${SITE_URL}/product/${encodeURIComponent(p.productId)}`,
      lastModified: Number.isFinite(p.lastModified.getTime()) ? p.lastModified : now,
      changeFrequency: "daily",
      priority: 0.7,
    }));
  } catch {
    // API unreachable — fall back to static-only sitemap.
    productEntries = [];
  }

  return [...staticEntries, ...productEntries];
}
