"use client";

// Per-shop chip strip — "Toutes les boutiques" + one chip per shop —
// rendered above the orders list when the seller owns more than one
// shop. Lets the seller scope the unified view to a single shop with
// one click. Single-shop sellers never see this strip; the component
// returns the children unwrapped.
//
// Walks the DOM (via useEffect) to toggle a `hidden` class on rows
// whose `data-shop-id` doesn't match the active filter, and on bucket
// headings whose `data-shop-ids` (space-separated set of shop IDs in
// the bucket) doesn't contain the active ID. Same pattern as
// ProductsListFilter — Tailwind's JIT can't compile arbitrary class
// strings with dynamic UUIDs, so the runtime walk is the safer route.
//
// Status, range, and search filters compose because they each toggle
// `hidden` independently (or via attribute-only CSS rules); whichever
// wants a row hidden gets it.

import { useEffect, useRef, useState } from "react";

interface Shop {
  sellerId: string;
  displayName: string;
  count: number;
}

interface OrdersShopFilterProps {
  shops: ReadonlyArray<Shop>;
  totalCount: number;
  children: React.ReactNode;
}

// Marker class so this filter's hide-toggles don't fight the
// `hidden` class set by other filters (search). When this filter
// removes the marker it doesn't accidentally re-show a row that
// search is hiding.
const HIDDEN_CLASS = "hidden-by-shop";

export function OrdersShopFilter({
  shops,
  totalCount,
  children,
}: OrdersShopFilterProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeShopId, setActiveShopId] = useState<string | null>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const rows = root.querySelectorAll<HTMLElement>("[data-shop-id]");
    const headings = root.querySelectorAll<HTMLElement>("[data-shop-ids]");
    if (activeShopId == null) {
      rows.forEach((el) => el.classList.remove(HIDDEN_CLASS));
      headings.forEach((el) => el.classList.remove(HIDDEN_CLASS));
      return;
    }
    rows.forEach((el) => {
      if (el.dataset.shopId === activeShopId) {
        el.classList.remove(HIDDEN_CLASS);
      } else {
        el.classList.add(HIDDEN_CLASS);
      }
    });
    headings.forEach((el) => {
      const set = (el.dataset.shopIds ?? "").split(/\s+/);
      if (set.includes(activeShopId)) {
        el.classList.remove(HIDDEN_CLASS);
      } else {
        el.classList.add(HIDDEN_CLASS);
      }
    });
  }, [activeShopId, children]);

  if (shops.length < 2) {
    return <>{children}</>;
  }

  return (
    <div ref={containerRef}>
      {/* Inline style applies display:none to our marker class. Kept
          here (not in a global stylesheet) so the marker only takes
          effect inside this filter's subtree and doesn't leak. */}
      <style>{`.${HIDDEN_CLASS} { display: none !important; }`}</style>
      <div
        role="tablist"
        aria-label="Filtrer par boutique"
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        <span className="text-[10px] uppercase tracking-widest text-ink-mute mr-1">
          Boutique
        </span>
        <button
          type="button"
          role="tab"
          aria-selected={activeShopId == null}
          onClick={() => setActiveShopId(null)}
          className={
            "inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium transition " +
            (activeShopId == null
              ? "bg-accent/15 text-accent border border-accent/40"
              : "border border-line text-ink-mute hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40")
          }
        >
          Toutes <span className="tabular-nums">({totalCount})</span>
        </button>
        {shops.map((s) => (
          <button
            key={s.sellerId}
            type="button"
            role="tab"
            aria-selected={activeShopId === s.sellerId}
            disabled={s.count === 0}
            onClick={() => setActiveShopId(s.sellerId)}
            className={
              "inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed " +
              (activeShopId === s.sellerId
                ? "bg-accent/15 text-accent border border-accent/40"
                : "border border-line text-ink-mute hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40")
            }
          >
            <span dir="auto" className="truncate max-w-[10rem]">
              {s.displayName}
            </span>
            <span className="tabular-nums">({s.count})</span>
          </button>
        ))}
      </div>
      {children}
      {activeShopId != null &&
        shops.find((s) => s.sellerId === activeShopId)?.count === 0 && (
          <div className="mt-2 rounded-lg border border-line-soft bg-bg/40 px-3 py-2 text-xs text-ink-soft">
            Aucune commande dans cette boutique.{" "}
            <button
              type="button"
              onClick={() => setActiveShopId(null)}
              className="text-accent underline-offset-2 hover:underline active:underline"
            >
              Voir toutes les boutiques
            </button>
            .
          </div>
        )}
    </div>
  );
}
