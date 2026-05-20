"use client";

// Tab strip above the unified orders list. Five buckets:
//   Toutes · À traiter · Expédiées · Livrées · Annulées
//
// Each tab tells the seller how many orders sit in its bucket so they
// can decide what to look at without first clicking through. Replaces
// the simpler binary OrdersListFilter on /seller/orders — the richer
// view deserves richer triage.
//
// Same data-attribute approach as the other filters in this dashboard:
// rows server-render with `data-status` (raw enum) and `data-actionable`
// (already there from earlier iterations). The wrapper toggles a CSS
// class that hides rows whose status doesn't belong to the selected
// tab. Bucket headings carry `data-status-set` listing every status in
// their date group, so a heading folds away in lockstep when its group
// has no rows matching the current tab.
//
// This composes with OrdersSearch (separate hidden-class toggle on
// data-search); CSS attribute selectors set `display: none` and the
// `hidden` class does the same — whichever wants the row hidden wins.

import { useState } from "react";

export type StatusTab = "all" | "actionable" | "shipped" | "delivered" | "closed";

interface OrdersStatusTabsProps {
  counts: Record<StatusTab, number>;
  totalCount: number;
  children: React.ReactNode;
}

const LABELS: Record<StatusTab, string> = {
  all: "Toutes",
  actionable: "À traiter",
  shipped: "Expédiées",
  delivered: "Livrées",
  closed: "Annulées",
};

// Each tab's set of CSS classes that hides rows + headings outside its
// bucket. Listed as full literal strings so Tailwind's JIT can see them
// at build time — concatenating from variables would not be safelisted.
const FILTER_CLASS: Record<StatusTab, string> = {
  all: "",
  actionable:
    "[&_[data-actionable='false']]:hidden " +
    "[&_[data-status-set]:not([data-status-set~='paid']):not([data-status-set~='fulfilling']):not([data-status-set~='disputed'])]:hidden",
  shipped:
    "[&_[data-status]:not([data-status='shipped'])]:hidden " +
    "[&_[data-status-set]:not([data-status-set~='shipped'])]:hidden",
  delivered:
    "[&_[data-status]:not([data-status='delivered'])]:hidden " +
    "[&_[data-status-set]:not([data-status-set~='delivered'])]:hidden",
  closed:
    "[&_[data-status]:not([data-status='cancelled']):not([data-status='refunded'])]:hidden " +
    "[&_[data-status-set]:not([data-status-set~='cancelled']):not([data-status-set~='refunded'])]:hidden",
};

const ORDER: ReadonlyArray<StatusTab> = ["all", "actionable", "shipped", "delivered", "closed"];

export function OrdersStatusTabs({
  counts,
  totalCount,
  children,
}: OrdersStatusTabsProps): React.JSX.Element {
  // Default to "À traiter" when there's outstanding work AND a mix of
  // states — opening the page lands directly on the rows that need
  // attention. Otherwise default to "Toutes" so the seller doesn't see
  // an empty filtered view on first paint.
  const [active, setActive] = useState<StatusTab>(
    counts.actionable > 0 && counts.actionable < totalCount ? "actionable" : "all",
  );

  return (
    <>
      <div
        role="tablist"
        aria-label="Filtrer par statut"
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        {ORDER.map((tab) => {
          const count = counts[tab];
          // Disable empty tabs — clicking a "Livrées (0)" tab would just
          // blank the view. Visual cue: opacity drop + no hover state.
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
              {tab === "actionable" && (
                <span
                  aria-hidden
                  className={
                    "w-1.5 h-1.5 rounded-full " +
                    (counts.actionable > 0 ? "bg-accent" : "bg-ink-mute")
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
          Aucune commande dans cette catégorie.{" "}
          <button
            type="button"
            onClick={() => setActive("all")}
            className="text-accent underline-offset-2 hover:underline active:underline"
          >
            Voir toutes les commandes
          </button>
          .
        </div>
      )}
    </>
  );
}
