import { NextResponse } from "next/server";
import { searchProducts } from "@/lib/api";
import { parseSearchParams } from "@/lib/url";
import { resolveCategorySlugs } from "@/lib/categories";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sp: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const all = searchParams.getAll(key);
    sp[key] = all.length === 1 ? all[0] : all;
  }
  const input = parseSearchParams(sp);
  try {
    // Mirror /search SSR: expand editorial alias slugs (e.g. "mode" →
    // ["vetements_mode"]) before the upstream fetch. Without this the
    // infinite-scroll continuation (InfiniteResults → /api/search?cursor=…)
    // returns 0 results once the user scrolls past the first page on any
    // alias slug, even though the initial SSR page rendered fine.
    const apiCategory = input.category?.flatMap(resolveCategorySlugs);
    const result = await searchProducts(
      apiCategory ? { ...input, category: apiCategory } : input,
    );
    // ETag fingerprint of the response: cursor + first hit's productId +
    // hit count. Two requests for the same (q, filters, cursor) tuple
    // get the same ETag iff the API returned the same first page —
    // catches "page changed under us" cases the cache-control window
    // alone wouldn't (e.g. a new product seeded into the slice between
    // the two calls). Strong (no W/) is fine because we control all the
    // ways the response body can change.
    const firstId = result.data[0]?.productId ?? "";
    const etag = `"s-${result.data.length}-${firstId}-${result.pagination.cursor ?? ""}"`;
    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          etag,
          "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
        },
      });
    }
    return NextResponse.json(
      {
        data: result.data,
        cursor: result.pagination.cursor,
      },
      {
        headers: {
          // Per-user browser cache only — InfiniteResults pulls the same
          // (q, filters, cursor) tuple repeatedly during a scroll session,
          // and a 60s window keeps responses warm without staling user-
          // visible counts. private prevents Cloudflare/edge caching since
          // results vary by every query parameter combination.
          "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
          etag,
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
