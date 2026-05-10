import Link from "next/link";

const API_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.MARKETPLACE_API_URL ??
  "http://127.0.0.1:3100"
).replace(/\/$/, "");

interface Facet {
  value: string;
  count: number;
}
interface SellerFacet {
  sellerId?: string;
  value?: string;
  displayName?: string | null;
  count: number;
}
interface FooterFacets {
  categories: Facet[];
  brands: Facet[];
  sellers: SellerFacet[];
}

// Module-level in-memory cache. The original `next: { revalidate: 600 }`
// hint on the fetch was apparently being ignored: production logs (iter-29)
// showed the CategoryFooter API call hitting /v1/products?limit=1 multiple
// times per second, helping push marketplace-api's healthcheck into a
// 34-failure streak (api went unhealthy / 502). The same cache pattern that
// fixed sitemap.ts works here too — sidesteps Next's caching layer entirely.
// 10-min TTL: facets change at most every few minutes (catalog seed loop),
// crawler/user reuse within a 10-min window doesn't go stale.
const FOOTER_TTL_MS = 10 * 60 * 1000;
let footerCache: { data: FooterFacets; ts: number } | null = null;
let footerInFlight: Promise<FooterFacets> | null = null;

async function getFooterFacets(): Promise<FooterFacets> {
  const now = Date.now();
  if (footerCache && now - footerCache.ts < FOOTER_TTL_MS) {
    return footerCache.data;
  }
  if (footerInFlight) return footerInFlight;
  footerInFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/v1/products?limit=1`, {
        headers: { accept: "application/json" },
        // cache:"no-store" so each rebuild sees fresh facets; the module
        // cache around this is what actually rate-limits the API.
        cache: "no-store",
      });
      if (!res.ok) return { categories: [], brands: [], sellers: [] };
      const body = (await res.json()) as {
        facets?: {
          categories?: Facet[];
          brands?: Facet[];
          sellers?: SellerFacet[];
        };
      };
      const data: FooterFacets = {
        categories: (body.facets?.categories ?? [])
          .filter((c) => c.value && c.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 18),
        brands: (body.facets?.brands ?? [])
          .filter((b) => b.value && b.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 16),
        sellers: (body.facets?.sellers ?? [])
          .filter((s) => (s.sellerId ?? s.value) && s.count > 0)
          .sort((a, b) => b.count - a.count),
      };
      // Only cache a non-empty payload — same iter-16/iter-29 lesson: don't
      // lock in a broken empty response just because the API hiccuped.
      if (data.categories.length > 0 || data.brands.length > 0 || data.sellers.length > 0) {
        footerCache = { data, ts: Date.now() };
      }
      return data;
    } catch (err) {
      console.error("[CategoryFooter] facet fetch failed:", err);
      return { categories: [], brands: [], sellers: [] };
    } finally {
      footerInFlight = null;
    }
  })();
  return footerInFlight;
}

// Server component rendering three browse blocks in the site footer
// (categories, brands, sellers). Each block links every page to every
// indexable single-key landing — without these the URLs are sitemap-only
// islands and Google's PageRank can't flow into them. Fetched once with a
// 10-min Next data-cache TTL so layout stays effectively static.
export async function CategoryFooter() {
  const { categories, brands, sellers } = await getFooterFacets();
  if (categories.length === 0 && brands.length === 0 && sellers.length === 0) return null;

  return (
    <div className="border-b border-line-soft">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        {categories.length > 0 && (
          <section aria-label="Browse by category">
            <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-3">
              Browse by category
            </h2>
            <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
              {categories.map((c) => {
                const human = c.value.replace(/[-_]/g, " ");
                return (
                  <li key={c.value}>
                    <Link
                      href={`/search?category=${encodeURIComponent(c.value)}`}
                      className="inline-flex items-center px-3 h-8 rounded-full bg-bg-soft border border-line-soft text-xs text-ink-soft hover:border-accent/40 hover:text-ink transition capitalize"
                    >
                      {human}
                      <span className="ml-1.5 text-ink-mute">{c.count}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {brands.length > 0 && (
          <section aria-label="Top brands">
            <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-3">
              Top brands
            </h2>
            <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
              {brands.map((b) => (
                <li key={b.value}>
                  <Link
                    href={`/search?brand=${encodeURIComponent(b.value)}`}
                    className="inline-flex items-center px-3 h-8 rounded-full bg-bg-soft border border-line-soft text-xs text-ink-soft hover:border-accent/40 hover:text-ink transition"
                  >
                    {b.value}
                    <span className="ml-1.5 text-ink-mute">{b.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {sellers.length > 0 && (
          <section aria-label="Sellers on Teno Store">
            <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-3">
              Sellers
            </h2>
            <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
              {sellers.map((s) => {
                const id = s.sellerId ?? s.value!;
                const name = s.displayName ?? "Storefront";
                return (
                  <li key={id}>
                    <Link
                      href={`/search?sellerId=${encodeURIComponent(id)}`}
                      className="inline-flex items-center px-3 h-8 rounded-full bg-bg-soft border border-line-soft text-xs text-ink-soft hover:border-accent/40 hover:text-ink transition"
                    >
                      {name}
                      <span className="ml-1.5 text-ink-mute">{s.count}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
