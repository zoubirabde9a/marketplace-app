"use client";

// Three-tab strip above the products list — Tous / En stock / Rupture —
// so a seller doing a stock audit can scope the list to the listings
// that need replenishment without scrolling the whole shop. Defaults
// to "Tous"; sits next to the search input from ProductsListFilter and
// composes with it cleanly (different data attribute).
//
// Same shape as OrdersStatusTabs: each row server-renders with
// `data-stock="in" | "out"` and the wrapper applies a Tailwind
// arbitrary-variant class that hides non-matching rows. Empty tabs
// disable so "Rupture (0)" doesn't blank the view when everything is
// in stock.

import { useState } from "react";

export type StockTab = "all" | "in" | "out";

interface ProductsStockFilterProps {
  counts: Record<StockTab, number>;
  children: React.ReactNode;
  /** Hide the tab strip entirely below this many products — typing
   * faster than scanning kicks in around 5–6 rows. */
  minCount?: number;
}

const LABELS: Record<StockTab, string> = {
  all: "Tous",
  in: "En stock",
  out: "Rupture",
};

// Pre-baked Tailwind classes so JIT sees them at build time —
// concatenating with template literals would not safelist.
const FILTER_CLASS: Record<StockTab, string> = {
  all: "",
  in: "[&_[data-stock]:not([data-stock='in'])]:hidden",
  out: "[&_[data-stock]:not([data-stock='out'])]:hidden",
};

const ORDER: ReadonlyArray<StockTab> = ["all", "in", "out"];

export function ProductsStockFilter({
  counts,
  children,
  minCount = 5,
}: ProductsStockFilterProps): React.JSX.Element {
  const [active, setActive] = useState<StockTab>("all");

  // Below the threshold, render children untouched — no tab strip,
  // no wrapper class. A 3-product shop doesn't need a filter UI.
  if (counts.all < minCount) {
    return <>{children}</>;
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Filtrer par disponibilité"
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        {ORDER.map((tab) => {
          const count = counts[tab];
          const disabled = tab !== "all" && count === 0;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active === tab}
              disabled={disabled}
              onClick={() => setActive(tab)}
              className={
                "inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed " +
                (active === tab
                  ? "bg-accent/15 text-accent border border-accent/40"
                  : "border border-line text-ink-mute hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40")
              }
            >
              {tab === "out" && (
                <span
                  aria-hidden
                  className={
                    "w-1.5 h-1.5 rounded-full " +
                    (counts.out > 0 ? "bg-warn" : "bg-ink-mute")
                  }
                />
              )}
              {LABELS[tab]} <span className="tabular-nums">({count})</span>
            </button>
          );
        })}
      </div>
      <div className={FILTER_CLASS[active]}>{children}</div>
      {active !== "all" && counts[active] === 0 && (
        <div className="mt-2 rounded-lg border border-line-soft bg-bg/40 px-3 py-2 text-xs text-ink-soft">
          Aucun produit dans cette catégorie.{" "}
          <button
            type="button"
            onClick={() => setActive("all")}
            className="text-accent underline-offset-2 hover:underline active:underline"
          >
            Voir tous les produits
          </button>
          .
        </div>
      )}
    </>
  );
}
