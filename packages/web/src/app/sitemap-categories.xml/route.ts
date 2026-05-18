import {
  SITEMAP_CACHE_HEADERS,
  buildCategoryEntries,
  getSitemapHarvest,
  renderUrlset,
} from "@/lib/sitemap";

export const revalidate = 300;

export async function GET(): Promise<Response> {
  const now = new Date();
  let body: string;
  try {
    const harvest = await getSitemapHarvest();
    body = renderUrlset(buildCategoryEntries(harvest, now));
  } catch (err) {
    console.error("[sitemap-categories] harvest failed:", err);
    body = renderUrlset([]);
  }
  return new Response(body, { headers: SITEMAP_CACHE_HEADERS });
}
