"use client";

// Type-as-you-go filter for the products list. Sellers with many listings
// (the API allows up to 100 in one page) waste time scrolling to find the
// row they want to edit; an inline filter that hides non-matching rows is
// the most direct fix.
//
// The product list stays server-rendered. Each <li> is tagged with
// `data-search` (lowercased "title brand" — added in page.tsx). On every
// keystroke we walk the children that carry that attribute and toggle a
// `hidden` class. We don't reorder anything — just visibility. This keeps
// untrusted-content rendering, the link wrapper, and image lazy-load all
// in the server-rendered output.
//
// Visible-count is mirrored to an aria-live region so screen readers
// announce "3 résultats sur 27" as the seller types — important on
// mobile where the visual scroll context can be hard to read.

import { useEffect, useMemo, useRef, useState } from "react";

interface ProductsListFilterProps {
  totalCount: number;
  /** Min count below which the filter input is hidden — 4 or fewer items
   * are scannable at a glance and the input would be more friction than
   * the scroll it saves. */
  minCount?: number;
  children: React.ReactNode;
}

export function ProductsListFilter({
  totalCount,
  minCount = 5,
  children,
}: ProductsListFilterProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(totalCount);

  const normalized = useMemo(() => query.trim().toLowerCase(), [query]);

  // Same global keyboard shortcuts as OrdersSearch (23e151a): "/" to
  // focus the input from anywhere on the page, Escape to clear + blur.
  // Keeps both unified search surfaces (orders + products) consistent
  // so the seller doesn't have to remember which one supports which
  // shortcut. Only attaches when the input is actually rendered —
  // when totalCount < minCount we early-return below and this effect's
  // cleanup pulls the listener.
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
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && ae === inputRef.current) {
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
    // Re-query each effect run — the children may have been replaced by a
    // router.refresh() (after a product delete or stock toggle) and any
    // cached node list would point at stale DOM.
    const rows = root.querySelectorAll<HTMLElement>("[data-search]");
    if (normalized === "") {
      let count = 0;
      rows.forEach((el) => {
        el.classList.remove("hidden");
        count++;
      });
      setVisibleCount(count);
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
    setVisibleCount(visible);
  }, [normalized, children]);

  // Hide the input entirely when the shop has few enough products that
  // typing is slower than scrolling. The threshold (5) is conservative —
  // mobile sellers running narrow viewports see ~3 rows above the fold.
  if (totalCount < minCount) {
    return <div ref={containerRef}>{children}</div>;
  }

  return (
    <div ref={containerRef}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[12rem]">
          <span className="sr-only">Filtrer les produits</span>
          {/* Magnifying glass — purely decorative; aria-hidden so screen
              readers skip it. The visible label is the sr-only span above. */}
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
            placeholder="Filtrer par titre ou marque…"
            className="w-full rounded-full bg-bg border border-line pl-9 pr-12 h-9 text-sm text-ink focus:border-accent/60 outline-none placeholder:text-ink-mute"
          />
          {/* "/" discoverability cue, mirroring OrdersSearch (23e151a).
              Hidden on mobile (no hardware keyboard) and once typing
              begins so it doesn't compete with content. */}
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
      {/* aria-live announces the result count as the seller types. polite
          (not assertive) so it doesn't interrupt; sr-only so sighted
          sellers see the visual list without an extra count line. */}
      <p className="sr-only" aria-live="polite">
        {visibleCount} produit{visibleCount === 1 ? "" : "s"} sur {totalCount}
      </p>
      {children}
      {query !== "" && visibleCount === 0 && (
        <div className="mt-2 rounded-lg border border-line-soft bg-bg/40 px-3 py-2 text-xs text-ink-soft">
          Aucun produit ne correspond à <span dir="auto" className="text-ink">« {query} »</span>.{" "}
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-accent underline-offset-2 hover:underline active:underline"
          >
            Effacer le filtre
          </button>
          .
        </div>
      )}
    </div>
  );
}
