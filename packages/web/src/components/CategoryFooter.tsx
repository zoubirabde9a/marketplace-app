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

// Server component that renders a "Browse by category" block in the footer.
// Used to live in layout's plain footer markup; promoted to its own component
// so we can fetch from the API (with a 10-minute Next data-cache TTL — categories
// change ~hourly at most) without making layout itself dynamic.
export async function CategoryFooter() {
  let categories: Facet[] = [];
  try {
    const res = await fetch(`${API_URL}/v1/products?limit=1`, {
      headers: { accept: "application/json" },
      next: { revalidate: 600 },
    });
    if (res.ok) {
      const body = (await res.json()) as { facets?: { categories?: Facet[] } };
      categories = (body.facets?.categories ?? [])
        .filter((c) => c.value && c.count > 0)
        // Surface the most populated 18 — keeps the footer compact and lets
        // Google's PageRank flow concentrate on the slugs that actually have
        // inventory rather than long-tail singletons.
        .sort((a, b) => b.count - a.count)
        .slice(0, 18);
    }
  } catch {
    // API hiccup — render nothing rather than break every page. The plain
    // navigation block below this still gives Google reachable internal
    // links to /search, /seller, /about.
  }

  if (categories.length === 0) return null;

  return (
    <section aria-label="Browse by category" className="border-b border-line-soft">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
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
      </div>
    </section>
  );
}
