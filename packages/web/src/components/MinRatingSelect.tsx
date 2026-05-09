"use client";

import { useRouter, useSearchParams } from "next/navigation";

const OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Any rating" },
  { value: "4", label: "4★ & up" },
  { value: "3", label: "3★ & up" },
  { value: "2", label: "2★ & up" },
];

export function MinRatingSelect() {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("minRating") ?? "";

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const sp = new URLSearchParams(params.toString());
    if (next) sp.set("minRating", next);
    else sp.delete("minRating");
    sp.delete("cursor");
    const qs = sp.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  }

  return (
    <label className="inline-flex items-center gap-2 text-xs text-ink-mute">
      <span className="uppercase tracking-widest font-semibold">Rating</span>
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
