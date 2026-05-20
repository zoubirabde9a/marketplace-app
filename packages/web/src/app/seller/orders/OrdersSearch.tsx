"use client";

// Type-as-you-go search for the unified orders list. Filters by public
// order number ("4729") or customer name ("Yacine") — the two facts a
// seller has when a buyer calls. Below the minimum threshold the input
// hides itself: searching a list of 3 orders is more friction than
// scrolling.
//
// Same DOM-walk pattern as ProductsListFilter on the dashboard: each
// <li> in the children carries `data-search` (a lowercased blob of
// number + customer name + shop name), and on every keystroke we walk
// the descendants and toggle a `hidden` class. The server-rendered list
// stays intact — no client re-fetch, no client re-render of order rows,
// untrusted-content rendering keeps streaming as part of the RSC
// payload.
//
// Date bucket headings carry data-search-heading instead, so we can
// hide them when all of their children are hidden by the search (avoids
// "Aujourd'hui" stranded above zero rows). The :has() check would be
// elegant but inconsistent across the browser baseline we target;
// walking the DOM works everywhere.

import { useEffect, useMemo, useRef, useState } from "react";

interface OrdersSearchProps {
  totalCount: number;
  minCount?: number;
  children: React.ReactNode;
  /** Pre-fill the search input — used when arriving via /seller/orders?q=
   * (e.g. clicking the "Client habitué" chip on a row). */
  initialQuery?: string;
}

export function OrdersSearch({
  totalCount,
  minCount = 6,
  children,
  initialQuery = "",
}: OrdersSearchProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [visibleCount, setVisibleCount] = useState(totalCount);

  const normalized = useMemo(() => query.trim().toLowerCase(), [query]);

  // Global keyboard shortcuts. "/" focuses the search input (GitHub /
  // Linear / Slack pattern) and "Escape" clears + blurs. Active only
  // when the input is actually rendered — when totalCount drops below
  // minCount and there's no initialQuery we early-return below and
  // this effect's cleanup pulls the listener.
  useEffect(() => {
    if (typeof document === "undefined") return;
    function onKeyDown(e: KeyboardEvent): void {
      const ae = document.activeElement as HTMLElement | null;
      const inField =
        ae != null &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.tagName === "SELECT" ||
          ae.isContentEditable);
      if (e.key === "/" && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Don't pre-empt the slash when the seller is typing into a
        // field; only act on the global / "press to search" gesture.
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && ae === inputRef.current) {
        // Clearing on Escape mirrors the "Effacer" pill behavior so
        // the keyboard shortcut and the visible button do the same
        // thing. Then blur so the seller can keep typing global
        // shortcuts without the input swallowing them.
        setQuery("");
        inputRef.current?.blur();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const rows = root.querySelectorAll<HTMLElement>("[data-search]");
    const headings = root.querySelectorAll<HTMLElement>("[data-search-heading]");
    if (normalized === "") {
      let visible = 0;
      rows.forEach((el) => {
        el.classList.remove("hidden");
        visible++;
      });
      headings.forEach((el) => el.classList.remove("hidden"));
      setVisibleCount(visible);
      return;
    }
    let visible = 0;
    rows.forEach((el) => {
      const hay = el.dataset.search ?? "";
      if (hay.includes(normalized)) {
        el.classList.remove("hidden");
        visible++;
      } else {
        el.classList.add("hidden");
      }
    });
    // After hiding rows, walk the heading set and hide those whose
    // sibling-row group has no visible members. The heading carries a
    // data-search-heading value matching the bucket label its rows
    // share via data-bucket; we look at the rows tagged with the same
    // bucket label.
    headings.forEach((h) => {
      const bucket = h.dataset.searchHeading;
      if (!bucket) return;
      const any = root.querySelector<HTMLElement>(
        `[data-search][data-bucket='${CSS.escape(bucket)}']:not(.hidden)`,
      );
      if (any) h.classList.remove("hidden");
      else h.classList.add("hidden");
    });
    setVisibleCount(visible);
  }, [normalized, children]);

  // Always render the input when we arrived with a pre-filled query —
  // even a tiny shop needs the visible filter UI so the seller can see
  // why only a subset is showing (and clear the filter back to all).
  if (totalCount < minCount && initialQuery === "") {
    return <div ref={containerRef}>{children}</div>;
  }

  return (
    <div ref={containerRef}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[14rem]">
          <span className="sr-only">Rechercher une commande</span>
          <span
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute text-sm"
          >
            🔍
          </span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Numéro de commande ou nom client…"
            // Right-aligned "/ to search" keyboard hint when the input
            // isn't focused or has nothing typed. Disappears once the
            // seller starts typing so it doesn't overlap text.
            className="w-full rounded-full bg-bg border border-line pl-9 pr-12 h-9 text-sm text-ink focus:border-accent/60 outline-none placeholder:text-ink-mute"
          />
          {query === "" && (
            <kbd
              aria-hidden
              className="hidden sm:inline-flex absolute right-3 top-1/2 -translate-y-1/2 items-center justify-center min-w-[1.25rem] h-5 px-1 rounded border border-line text-[10px] text-ink-mute bg-bg-elev pointer-events-none"
            >
              /
            </kbd>
          )}
        </label>
        {query !== "" && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="inline-flex items-center px-3 h-9 rounded-full border border-line text-xs text-ink-mute hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
          >
            Effacer
          </button>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {visibleCount} commande{visibleCount === 1 ? "" : "s"} sur {totalCount}
      </p>
      {children}
      {query !== "" && visibleCount === 0 && (
        <div className="mt-2 rounded-lg border border-line-soft bg-bg/40 px-3 py-2 text-xs text-ink-soft">
          Aucune commande ne correspond à{" "}
          <span dir="auto" className="text-ink">« {query} »</span>.{" "}
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-accent underline-offset-2 hover:underline active:underline"
          >
            Effacer la recherche
          </button>
          .
        </div>
      )}
    </div>
  );
}
