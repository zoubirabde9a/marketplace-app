"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function BrandSelect({
  brands,
}: {
  brands: Array<{ value: string; count: number }>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("brand") ?? "";

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const sp = new URLSearchParams(params.toString());
    if (next) sp.set("brand", next);
    else sp.delete("brand");
    sp.delete("cursor");
    const qs = sp.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  }

  // If the URL has a brand that isn't in the current facet list (e.g. zero
  // results), still render it so the user can see and clear it.
  const options = [...brands];
  if (current && !options.some((b) => b.value === current)) {
    options.unshift({ value: current, count: 0 });
  }

  if (options.length === 0) return null;

  return (
    <label className="inline-flex items-center gap-2 text-xs text-ink-mute">
      <span className="uppercase tracking-widest font-semibold">Brand</span>
      <select
        value={current}
        onChange={onChange}
        className="h-8 px-2 rounded-md bg-bg-soft border border-line text-ink-soft text-xs hover:border-accent/40 focus:border-accent focus:outline-none transition max-w-[14ch]"
      >
        <option value="">All</option>
        {options.map((b) => (
          <option key={b.value} value={b.value}>
            {b.value}
            {b.count > 0 ? ` (${b.count})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
