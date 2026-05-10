import { NextResponse } from "next/server";
import { searchProducts } from "@/lib/api";
import { parseSearchParams } from "@/lib/url";

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
    const result = await searchProducts(input);
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
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
