"use client";

// Two-state sort toggle — Récentes (default) or Anciennes. Sellers
// doing FIFO fulfillment want the oldest unactioned orders at the
// top of the list so they can clear them first; sellers checking
// "what just came in" want the default.
//
// URL-driven via ?sort=oldest so the choice survives refreshes,
// auto-refresh ticks, and copy-paste links. Preserves the existing
// ?q query so a customer-filter search isn't lost on sort change.

import { useRouter, useSearchParams } from "next/navigation";

type Sort = "newest" | "oldest";

export function OrdersSortToggle(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const current: Sort = params.get("sort") === "oldest" ? "oldest" : "newest";

  function set(next: Sort): void {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (next === "newest") {
      sp.delete("sort"); // default value: omit from URL
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
          ["newest", "Plus récentes"],
          ["oldest", "Plus anciennes"],
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
