"use client";

// Per-shop chip strip for the unified /seller/products view. Symmetric
// with OrdersShopFilter (bb37ef3) but simpler — no date headings to
// hide in lockstep, just rows. Renders only when sellers.length > 1;
// single-shop sellers see no extra UI.
//
// Same DOM-walk pattern: each row server-renders with data-shop-id,
// the wrapper toggles a namespaced `.hidden-by-shop` class on rows
// whose ID doesn't match the active filter. The marker class is
// scoped via an inline <style> tag so it doesn't conflict with the
// other product filters (search and stock) which use their own hide
// mechanisms.

import { useEffect, useRef, useState } from "react";

interface Shop {
  sellerId: string;
  displayName: string;
  count: number;
}

interface ProductsShopFilterProps {
  shops: ReadonlyArray<Shop>;
  totalCount: number;
  children: React.ReactNode;
}

const HIDDEN_CLASS = "hidden-by-shop";

export function ProductsShopFilter({
  shops,
  totalCount,
  children,
}: ProductsShopFilterProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeShopId, setActiveShopId] = useState<string | null>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const rows = root.querySelectorAll<HTMLElement>("[data-shop-id]");
    if (activeShopId == null) {
      rows.forEach((el) => el.classList.remove(HIDDEN_CLASS));
      return;
    }
    rows.forEach((el) => {
      if (el.dataset.shopId === activeShopId) {
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
            Aucun produit dans cette boutique.{" "}
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
