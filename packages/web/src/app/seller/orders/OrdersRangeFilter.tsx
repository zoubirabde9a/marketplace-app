"use client";

// Period filter — Tout / 30 jours / 7 jours — layered above the status
// tabs on /seller/orders. High-volume sellers reconciling sales for a
// specific window get a one-click scope; default stays "Tout" so the
// first paint doesn't hide history a seller might be looking for.
//
// Same data-attribute + Tailwind arbitrary-variant pattern as the
// status tabs (OrdersStatusTabs) — each row carries `data-within-30d`
// and `data-within-7d`, bucket headings carry `data-any-within-30d`
// / `data-any-within-7d` computed server-side from their rows. The
// wrapper applies a class that hides rows + headings outside the
// active range; status tabs and search compose because they use
// different attributes and selectors.

import { useState } from "react";

export type RangeTab = "all" | "30d" | "7d";

interface OrdersRangeFilterProps {
  counts: Record<RangeTab, number>;
  children: React.ReactNode;
}

const LABELS: Record<RangeTab, string> = {
  all: "Tout",
  "30d": "30 jours",
  "7d": "7 jours",
};

const FILTER_CLASS: Record<RangeTab, string> = {
  all: "",
  "30d":
    "[&_[data-within-30d='false']]:hidden " +
    "[&_[data-any-within-30d='false']]:hidden",
  "7d":
    "[&_[data-within-7d='false']]:hidden " +
    "[&_[data-any-within-7d='false']]:hidden",
};

const ORDER: ReadonlyArray<RangeTab> = ["all", "30d", "7d"];

export function OrdersRangeFilter({
  counts,
  children,
}: OrdersRangeFilterProps): React.JSX.Element {
  const [active, setActive] = useState<RangeTab>("all");

  return (
    <>
      <div
        role="tablist"
        aria-label="Filtrer par période"
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        <span className="text-[10px] uppercase tracking-widest text-ink-mute mr-1">
          Période
        </span>
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
              {LABELS[tab]} <span className="tabular-nums">({count})</span>
            </button>
          );
        })}
      </div>
      <div className={FILTER_CLASS[active]}>{children}</div>
      {active !== "all" && counts[active] === 0 && (
        <div className="mt-2 rounded-lg border border-line-soft bg-bg/40 px-3 py-2 text-xs text-ink-soft">
          Aucune commande sur cette période.{" "}
          <button
            type="button"
            onClick={() => setActive("all")}
            className="text-accent underline-offset-2 hover:underline active:underline"
          >
            Voir tout l’historique
          </button>
          .
        </div>
      )}
    </>
  );
}
