import {
  SITEMAP_CACHE_HEADERS,
  buildProductShard,
  getSitemapHarvest,
  productShardCount,
  renderUrlset,
} from "@/lib/sitemap";

// force-dynamic so Next.js doesn't try to prerender at build time (which
// errors with "Cannot destructure property 'shard'" because the [shard]
// param is undefined during static analysis). Edge caching is handled
// explicitly via SITEMAP_CACHE_HEADERS in the response.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ shard: string }> },
): Promise<Response> {
  const { shard } = await params;
  const n = Number(shard);
  if (!Number.isInteger(n) || n < 1) {
    return new Response("Not Found", { status: 404 });
  }
  const now = new Date();
  let body: string;
  try {
    const harvest = await getSitemapHarvest();
    if (n > productShardCount(harvest)) {
      return new Response("Not Found", { status: 404 });
    }
    body = renderUrlset(buildProductShard(harvest, n - 1, now));
  } catch (err) {
    console.error("[sitemap-products] harvest failed:", err);
    body = renderUrlset([]);
  }
  return new Response(body, { headers: SITEMAP_CACHE_HEADERS });
}
