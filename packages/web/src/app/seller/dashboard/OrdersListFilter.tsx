"use client";

// Client wrapper that adds an "À traiter / Toutes" tab strip above the
// server-rendered orders list. Keeps the list itself server-rendered (so
// untrusted-content envelopes, image URLs, and customer contact info still
// stream as part of the initial RSC payload) and only flips a CSS class on
// the wrapper to hide non-actionable rows when the filter is on.
//
// The server-rendered orders list must tag each <li> with
// `data-actionable="true" | "false"`. The arbitrary-selector class below
// targets those data attributes — Tailwind's JIT compiles it as a normal
// CSS rule. Hide via display:none rather than CSS visibility so the rows
// fully collapse out of the layout (no ghost gaps in the divider list).
//
// Persists the choice across renders via component state only — sellers
// typically open the dashboard once per session, so a URL param would add
// noise without much benefit. router.refresh() (triggered after a state
// transition by OrderActions) keeps the filter state because the
// component remains mounted.

import { useState } from "react";

interface OrdersListFilterProps {
  actionableCount: number;
  totalCount: number;
  children: React.ReactNode;
}

export function OrdersListFilter({
  actionableCount,
  totalCount,
  children,
}: OrdersListFilterProps): React.JSX.Element {
  // Default to "actionable" only when there's actionable work to do AND
  // there are non-actionable rows worth hiding. If every order is
  // actionable (or no order is), defaulting to filter-on either changes
  // nothing or hides everything — both are worse than showing all.
  const [filter, setFilter] = useState<"actionable" | "all">(
    actionableCount > 0 && actionableCount < totalCount ? "actionable" : "all",
  );

  const tabBase =
    "inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium transition";
  const tabActive = "bg-accent/15 text-accent border border-accent/40";
  const tabInactive =
    "border border-line text-ink-mute hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40";

  return (
    <>
      {/* Hide the tab strip entirely when there's only one row — no
          filtering decision to make, the chip would be noise. */}
      {totalCount > 1 && (
        <div role="tablist" aria-label="Filtrer les commandes" className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={filter === "actionable"}
            onClick={() => setFilter("actionable")}
            disabled={actionableCount === 0}
            className={
              tabBase +
              " disabled:opacity-50 disabled:cursor-not-allowed " +
              (filter === "actionable" ? tabActive : tabInactive)
            }
          >
            <span
              aria-hidden
              className={
                "w-1.5 h-1.5 rounded-full " +
                (actionableCount > 0 ? "bg-accent" : "bg-ink-mute")
              }
            />
            À traiter{" "}
            <span className="tabular-nums">({actionableCount})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            onClick={() => setFilter("all")}
            className={tabBase + " " + (filter === "all" ? tabActive : tabInactive)}
          >
            Toutes <span className="tabular-nums">({totalCount})</span>
          </button>
        </div>
      )}
      <div
        className={
          filter === "actionable"
            ? "[&_[data-actionable='false']]:hidden"
            : ""
        }
      >
        {children}
      </div>
      {/* Empty-state hint when the filter hides every row. Only shows when
          actionable is the active view and the count is zero — happens
          after the seller marks the last paid order as shipped, for
          example. Gives them an obvious way back to the full list. */}
      {filter === "actionable" && actionableCount === 0 && totalCount > 0 && (
        <div className="mt-2 rounded-lg border border-line-soft bg-bg/40 px-3 py-2 text-xs text-ink-soft">
          Plus rien à traiter pour le moment.{" "}
          <button
            type="button"
            onClick={() => setFilter("all")}
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
