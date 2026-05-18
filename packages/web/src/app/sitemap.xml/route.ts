import {
  SITE_URL,
  SITEMAP_CACHE_HEADERS,
  getSitemapHarvest,
  productShardCount,
  renderSitemapIndex,
} from "@/lib/sitemap";

// In production, Caddy serves /sitemap*.xml from /srv/sitemaps directly
// (see Caddyfile + marketplace-sitemap-rebuild.timer) and this route is
// never hit. It exists as the fall-through for local dev and as a fresh-
// deploy safety net before the first timer tick.
export const revalidate = 300;

export async function GET(): Promise<Response> {
  const now = new Date();
  const nowIso = now.toISOString();
  let shardCount = 1;
  try {
    const harvest = await getSitemapHarvest();
    shardCount = productShardCount(harvest);
  } catch (err) {
    console.error("[sitemap.xml] harvest failed, emitting single-shard index:", err);
  }
  const children = [
    { loc: `${SITE_URL}/sitemap-static.xml`, lastmod: nowIso },
    { loc: `${SITE_URL}/sitemap-categories.xml`, lastmod: nowIso },
    ...Array.from({ length: shardCount }, (_, i) => ({
      loc: `${SITE_URL}/sitemap-products-${i + 1}.xml`,
      lastmod: nowIso,
    })),
  ];
  return new Response(renderSitemapIndex(children), { headers: SITEMAP_CACHE_HEADERS });
}
