import { SITEMAP_CACHE_HEADERS, buildStaticEntries, renderUrlset } from "@/lib/sitemap";

export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const body = renderUrlset(buildStaticEntries(new Date()));
  return new Response(body, { headers: SITEMAP_CACHE_HEADERS });
}
