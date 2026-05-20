"use client";

// Three-option sort toggle for /seller/customers. URL-driven via
// ?sort= so the choice survives refreshes and works in shared
// links. Defaults to "recent" — newest-last-order first — which
// answers "who just bought from me?".
//
// Other dimensions answer different questions:
//   • spend → "who are my whales?"
//   • orders → "who's most loyal?"

import { useRouter, useSearchParams } from "next/navigation";

export type CustomersSort = "recent" | "spend" | "orders";

const ORDER: ReadonlyArray<[CustomersSort, string]> = [
  ["recent", "Récents"],
  ["spend", "Dépense"],
  ["orders", "Commandes"],
];

export function CustomersSortToggle(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("sort");
  const current: CustomersSort =
    raw === "spend" || raw === "orders" ? raw : "recent";

  function set(next: CustomersSort): void {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (next === "recent") {
      sp.delete("sort"); // default — omit
    } else {
      sp.set("sort", next);
    }
    const qs = sp.toString();
    router.push(qs ? `?${qs}` : "?", { scroll: false });
  }

  return (
    <div
      role="group"
      aria-label="Trier les clients"
      className="mb-3 inline-flex items-center gap-1 rounded-full border border-line p-0.5 self-start"
    >
      {ORDER.map(([key, label]) => (
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
