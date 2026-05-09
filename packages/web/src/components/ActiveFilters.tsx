import Link from "next/link";

type Raw = Record<string, string | string[] | undefined>;

function buildHrefRemoving(sp: Raw, key: string, value?: string): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    if (k === "cursor") continue;
    if (k === key) {
      if (value === undefined) continue;
      const list = Array.isArray(v) ? v : [v];
      for (const item of list) if (item !== value) p.append(k, item);
      continue;
    }
    if (Array.isArray(v)) for (const item of v) p.append(k, item);
    else p.append(k, v);
  }
  const qs = p.toString();
  return qs ? `/search?${qs}` : "/search";
}

function priceLabel(min?: string, max?: string): string {
  const fmt = (s: string) => {
    const n = Number(s);
    if (!Number.isFinite(n)) return s;
    return `$${(n / 100).toFixed(2)}`;
  };
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (min) return `≥ ${fmt(min)}`;
  if (max) return `≤ ${fmt(max)}`;
  return "";
}

interface Chip {
  label: string;
  href: string;
}

export function ActiveFilters({
  sp,
  sellerDisplayNames,
}: {
  sp: Raw;
  sellerDisplayNames?: Record<string, string | null | undefined>;
}) {
  const chips: Chip[] = [];

  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "";
  if (q) chips.push({ label: `“${q}”`, href: buildHrefRemoving(sp, "q") });

  const brand = (Array.isArray(sp.brand) ? sp.brand[0] : sp.brand) ?? "";
  if (brand) chips.push({ label: brand, href: buildHrefRemoving(sp, "brand") });

  const cats = ([] as string[]).concat(sp.category ?? []);
  for (const c of cats) chips.push({ label: c, href: buildHrefRemoving(sp, "category", c) });

  const sellers = ([] as string[]).concat((sp.sellerId as string | string[]) ?? []);
  for (const s of sellers) {
    const name = sellerDisplayNames?.[s];
    const label = name && name.trim() ? name : `seller ${s.length > 6 ? s.slice(-6) : s}`;
    chips.push({ label, href: buildHrefRemoving(sp, "sellerId", s) });
  }

  const priceMin = (Array.isArray(sp.priceMin) ? sp.priceMin[0] : sp.priceMin) ?? "";
  const priceMax = (Array.isArray(sp.priceMax) ? sp.priceMax[0] : sp.priceMax) ?? "";
  const pl = priceLabel(priceMin, priceMax);
  if (pl) {
    let href = buildHrefRemoving(sp, "priceMin");
    href = href.replace(/([?&])priceMax=[^&]*/g, "$1").replace(/[?&]$/, "");
    chips.push({ label: pl, href });
  }

  const minRating = (Array.isArray(sp.minRating) ? sp.minRating[0] : sp.minRating) ?? "";
  if (minRating) chips.push({ label: `${minRating}★ & up`, href: buildHrefRemoving(sp, "minRating") });

  const sort = (Array.isArray(sp.sort) ? sp.sort[0] : sp.sort) ?? "";
  if (sort && sort !== "relevance") {
    const labels: Record<string, string> = {
      price_asc: "cheapest first",
      price_desc: "priciest first",
      newest: "newest",
      rating: "top rated",
    };
    chips.push({ label: labels[sort] ?? sort, href: buildHrefRemoving(sp, "sort") });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      <span className="text-[11px] uppercase tracking-widest text-ink-mute font-semibold">Showing</span>
      {chips.map((c) => (
        <Link
          key={c.label + c.href}
          href={c.href}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition"
        >
          <span className="truncate max-w-[20ch]">{c.label}</span>
          <span aria-hidden className="text-ink-mute">×</span>
        </Link>
      ))}
      {chips.length > 1 && (
        <Link href="/search" className="text-xs text-ink-mute hover:text-accent">
          clear all
        </Link>
      )}
    </div>
  );
}
