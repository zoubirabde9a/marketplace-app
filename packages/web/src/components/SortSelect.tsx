"use client";

import { useRouter, useSearchParams } from "next/navigation";

const OPTIONS: Array<{ value: string; label: string }> = [
  { value: "relevance", label: "Most relevant" },
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Cheapest first" },
  { value: "price_desc", label: "Priciest first" },
  { value: "rating", label: "Top rated" },
];

export function SortSelect() {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("sort") ?? "relevance";

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const sp = new URLSearchParams(params.toString());
    if (next && next !== "relevance") sp.set("sort", next);
    else sp.delete("sort");
    sp.delete("cursor");
    const qs = sp.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  }

  return (
    <label className="inline-flex items-center gap-2 text-xs text-ink-mute">
      <span className="uppercase tracking-widest font-semibold">Sort</span>
      <select
        value={current}
        onChange={onChange}
        className="h-8 px-2 rounded-md bg-bg-soft border border-line text-ink-soft text-xs hover:border-accent/40 focus:border-accent focus:outline-none transition"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
