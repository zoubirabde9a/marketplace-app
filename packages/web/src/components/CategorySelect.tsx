"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function CategorySelect({
  categories,
}: {
  categories: Array<{ value: string; count: number }>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // category is multi-valued in the API; for the simple select we treat the
  // first value as "current" and replace it on change.
  const current = params.getAll("category")[0] ?? "";

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const sp = new URLSearchParams(params.toString());
    sp.delete("category");
    if (next) sp.append("category", next);
    sp.delete("cursor");
    const qs = sp.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  }

  const options = [...categories];
  if (current && !options.some((c) => c.value === current)) {
    options.unshift({ value: current, count: 0 });
  }
  if (options.length === 0) return null;

  return (
    <label className="inline-flex items-center gap-2 text-xs text-ink-mute">
      <span className="uppercase tracking-widest font-semibold">Category</span>
      <select
        value={current}
        onChange={onChange}
        className="h-8 px-2 rounded-md bg-bg-soft border border-line text-ink-soft text-xs hover:border-accent/40 focus:border-accent focus:outline-none transition max-w-[14ch]"
      >
        <option value="">All</option>
        {options.map((c) => (
          <option key={c.value} value={c.value}>
            {c.value}
            {c.count > 0 ? ` (${c.count})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
