"use client";

// Type-as-you-go search for /seller/customers. Mirror of OrdersSearch
// + ProductsListFilter — server-rendered rows tagged with `data-search`,
// client wrapper toggles a `hidden` class on non-matching descendants.
//
// Same auto-hide threshold (6 customers) and same "/" + Escape keyboard
// shortcuts so the seller's muscle memory carries from the orders /
// products search to here.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

interface CustomersSearchProps {
  totalCount: number;
  minCount?: number;
  children: React.ReactNode;
}

export function CustomersSearch({
  totalCount,
  minCount = 6,
  children,
}: CustomersSearchProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Pre-fill from ?q URL param so a deep-link to a specific
  // customer pre-filters the list. Same pattern OrdersSearch
  // uses (iteration 19). useSearchParams is client-only;
  // useState seed runs once and ignores later URL changes
  // (the seller can still edit the input freely from there).
  const initialParams = useSearchParams();
  const [query, setQuery] = useState(() => initialParams.get("q") ?? "");
  const [visibleCount, setVisibleCount] = useState(totalCount);

  const normalized = useMemo(() => query.trim().toLowerCase(), [query]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const rows = root.querySelectorAll<HTMLElement>("[data-search]");
    if (normalized === "") {
      let visible = 0;
      rows.forEach((el) => {
        el.classList.remove("hidden");
        visible++;
      });
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
    setVisibleCount(visible);
  }, [normalized, children]);

  // "/" focuses, Escape clears + blurs — same vocabulary as the
  // other search inputs in the seller surface.
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

  // Always render the input when we arrived with a pre-filled query
  // (e.g. via /seller/customers?q=… deep-link), even on tiny lists
  // — the seller needs to see why only a subset is showing AND have
  // a clear path to clear back to "all customers".
  if (totalCount < minCount && query === "") {
    return <div ref={containerRef}>{children}</div>;
  }

  return (
    <div ref={containerRef}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[14rem]">
          <span className="sr-only">Rechercher un client</span>
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
            placeholder="Nom, téléphone ou wilaya…"
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
        {visibleCount} client{visibleCount === 1 ? "" : "s"} sur {totalCount}
      </p>
      {children}
      {query !== "" && visibleCount === 0 && (
        <div className="mt-2 rounded-lg border border-line-soft bg-bg/40 px-3 py-2 text-xs text-ink-soft">
          Aucun client ne correspond à{" "}
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
