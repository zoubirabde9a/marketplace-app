"use client";

// Two-state sort toggle for /seller/products. URL-driven via
// ?sort=oldest so a sort choice survives refreshes, auto-refresh
// ticks, and shared links. Mirror of OrdersSortToggle with
// masculine-plural labels matching "produits".
//
// Useful direction: oldest-first surfaces stale inventory the
// seller may want to re-price, refresh, or delete. Newest-first
// (default) is the "what's been listed recently" view.

import { useRouter, useSearchParams } from "next/navigation";

type Sort = "newest" | "oldest";

export function ProductsSortToggle(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const current: Sort = params.get("sort") === "oldest" ? "oldest" : "newest";

  function set(next: Sort): void {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (next === "newest") {
      sp.delete("sort");
    } else {
      sp.set("sort", next);
    }
    const qs = sp.toString();
    router.push(qs ? `?${qs}` : "?", { scroll: false });
  }

  return (
    <div
      role="group"
      aria-label="Ordre d’affichage"
      className="mb-3 inline-flex items-center gap-1 rounded-full border border-line p-0.5 self-start"
    >
      {(
        [
          ["newest", "Plus récents"],
          ["oldest", "Plus anciens"],
        ] as ReadonlyArray<[Sort, string]>
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={current === key}
          onClick={() => set(key)}
          className={
            "inline-flex items-center px-3 h-7 rounded-full text-xs font-medium transition " +
            (current === key
              ? "bg-accent/15 text-accent"
              : "text-ink-mute hover:text-ink active:text-ink")
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
