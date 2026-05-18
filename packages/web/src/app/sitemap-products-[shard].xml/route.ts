import {
  SITEMAP_CACHE_HEADERS,
  buildProductShard,
  getSitemapHarvest,
  productShardCount,
  renderUrlset,
} from "@/lib/sitemap";

export const revalidate = 300;

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
