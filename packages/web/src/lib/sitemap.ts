import { upscaleOuedknissForCrawler } from "@/lib/images";
import { BLOG_POSTS } from "@/app/blog/posts";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

const API_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.MARKETPLACE_API_URL ??
  "http://127.0.0.1:3100"
).replace(/\/$/, "");

export const URLS_PER_PRODUCT_SHARD = 40000;

const HARVEST_TTL_MS = 30 * 60 * 1000;
const STALE_MAX_MS = 4 * 60 * 60 * 1000;

let cachedHarvest: { data: SitemapHarvest; ts: number } | null = null;
let inFlight: Promise<SitemapHarvest> | null = null;

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

export interface SitemapProduct {
  productId: string;
  lastModified: Date;
  heroImageUrl?: string;
}

export interface SitemapHarvest {
  products: SitemapProduct[];
  brands: string[];
  sellerIds: string[];
  categories: string[];
}

export async function getSitemapHarvest(): Promise<SitemapHarvest> {
  const now = Date.now();
  if (cachedHarvest) {
    const age = now - cachedHarvest.ts;
    if (age < HARVEST_TTL_MS) return cachedHarvest.data;
    if (age < STALE_MAX_MS) {
      if (!inFlight) {
        inFlight = (async () => {
          try {
            const data = await harvestUncached();
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
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const data = await harvestUncached();
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

async function harvestUncached(): Promise<SitemapHarvest> {
  const products: SitemapProduct[] = [];
  const brands: string[] = [];
  const sellerIds: string[] = [];
  const categories: string[] = [];
  let cursor: string | null = null;
  const MAX_PAGES = 500;
  const LIMIT = 100;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams();
    params.set("limit", String(LIMIT));
    if (cursor) params.set("cursor", cursor);
    const url = `${API_URL}/v1/products?${params.toString()}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    } catch (err) {
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
    if (page === 0) {
      const MIN_FACET_COUNT = 5;
      for (const b of body.facets?.brands ?? []) {
        if (b.value && b.count >= MIN_FACET_COUNT && !brands.includes(b.value)) brands.push(b.value);
      }
      for (const s of body.facets?.sellers ?? []) {
        const id = s.sellerId ?? s.value;
        if (id && s.count >= MIN_FACET_COUNT && !sellerIds.includes(id)) sellerIds.push(id);
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

export const ALIAS_SLUGS = [
  "smartphones", "portables", "electromenager", "mode", "vehicules",
  "femme", "homme", "accessoires", "traditionnel", "bebe", "sport",
  "ordinateurs", "ecrans", "peripheriques", "jeux",
  "maison", "decoration", "salon",
  "motos", "voitures",
];

export const STATIC_PATH_ENTRIES = [
  { path: "", changefreq: "daily", priority: "1.0" },
  { path: "/search", changefreq: "hourly", priority: "0.9" },
  { path: "/seller", changefreq: "monthly", priority: "0.5" },
  { path: "/about", changefreq: "monthly", priority: "0.5" },
  { path: "/blog", changefreq: "weekly", priority: "0.7" },
  { path: "/blog/rss.xml", changefreq: "weekly", priority: "0.5" },
  { path: "/llms.txt", changefreq: "daily", priority: "0.9" },
  { path: "/llms-full.txt", changefreq: "daily", priority: "0.9" },
  { path: "/.well-known/agents.json", changefreq: "daily", priority: "0.9" },
  { path: "/.well-known/ai-policy.json", changefreq: "monthly", priority: "0.7" },
];

export interface UrlEntry {
  loc: string;
  lastmod: string;
  changefreq?: string;
  priority?: string;
  image?: string;
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderUrlset(entries: UrlEntry[]): string {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/0.9">',
  ];
  for (const e of entries) {
    parts.push("<url>");
    parts.push(`<loc>${xmlEscape(e.loc)}</loc>`);
    parts.push(`<lastmod>${e.lastmod}</lastmod>`);
    if (e.changefreq) parts.push(`<changefreq>${e.changefreq}</changefreq>`);
    if (e.priority) parts.push(`<priority>${e.priority}</priority>`);
    if (e.image) {
      parts.push("<image:image>");
      parts.push(`<image:loc>${xmlEscape(e.image)}</image:loc>`);
      parts.push("</image:image>");
    }
    parts.push("</url>");
  }
  parts.push("</urlset>");
  return parts.join("\n");
}

export function renderSitemapIndex(children: Array<{ loc: string; lastmod: string }>): string {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const c of children) {
    parts.push("<sitemap>");
    parts.push(`<loc>${xmlEscape(c.loc)}</loc>`);
    parts.push(`<lastmod>${c.lastmod}</lastmod>`);
    parts.push("</sitemap>");
  }
  parts.push("</sitemapindex>");
  return parts.join("\n");
}

export function buildStaticEntries(now: Date): UrlEntry[] {
  const nowIso = now.toISOString();
  return [
    ...STATIC_PATH_ENTRIES.map((s) => ({
      loc: `${SITE_URL}${s.path}`,
      lastmod: nowIso,
      changefreq: s.changefreq,
      priority: s.priority,
    })),
    ...BLOG_POSTS.map((p) => ({
      loc: `${SITE_URL}/blog/${p.slug}`,
      lastmod: new Date(p.dateModified).toISOString(),
      changefreq: "monthly",
      priority: "0.6",
    })),
  ];
}

export function buildCategoryEntries(harvest: SitemapHarvest, now: Date): UrlEntry[] {
  const nowIso = now.toISOString();
  const categorySet = new Set(harvest.categories);
  return [
    ...harvest.categories.flatMap((c) => [
      {
        loc: `${SITE_URL}/c/${encodeURIComponent(c)}`,
        lastmod: nowIso,
        changefreq: "daily",
        priority: "0.8",
      },
      {
        loc: `${SITE_URL}/search?category=${encodeURIComponent(c)}`,
        lastmod: nowIso,
        changefreq: "daily",
        priority: "0.7",
      },
    ]),
    ...ALIAS_SLUGS.filter((s) => !categorySet.has(s)).map((s) => ({
      loc: `${SITE_URL}/c/${encodeURIComponent(s)}`,
      lastmod: nowIso,
      changefreq: "daily",
      priority: "0.8",
    })),
    ...harvest.brands.map((b) => ({
      loc: `${SITE_URL}/search?brand=${encodeURIComponent(b)}`,
      lastmod: nowIso,
      changefreq: "daily",
      priority: "0.6",
    })),
    ...harvest.sellerIds.map((id) => ({
      loc: `${SITE_URL}/store/${encodeURIComponent(id)}`,
      lastmod: nowIso,
      changefreq: "daily",
      priority: "0.6",
    })),
  ];
}

export function buildProductShard(harvest: SitemapHarvest, shardIndex: number, now: Date): UrlEntry[] {
  const start = shardIndex * URLS_PER_PRODUCT_SHARD;
  const slice = harvest.products.slice(start, start + URLS_PER_PRODUCT_SHARD);
  const nowIso = now.toISOString();
  return slice.map((p) => ({
    loc: `${SITE_URL}/product/${encodeURIComponent(p.productId)}`,
    lastmod: Number.isFinite(p.lastModified.getTime()) ? p.lastModified.toISOString() : nowIso,
    changefreq: "daily",
    priority: "0.7",
    ...(p.heroImageUrl ? { image: upscaleOuedknissForCrawler(p.heroImageUrl) } : {}),
  }));
}

export function productShardCount(harvest: SitemapHarvest): number {
  return Math.max(1, Math.ceil(harvest.products.length / URLS_PER_PRODUCT_SHARD));
}

export const SITEMAP_CACHE_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
} as const;
