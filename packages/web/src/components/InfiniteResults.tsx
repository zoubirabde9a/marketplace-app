"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchHit } from "@/lib/api";
import { ProductCard } from "./ProductCard";

interface InfiniteResultsProps {
  initialHits: SearchHit[];
  initialCursor: string | null;
  // The current /search query (without `cursor=`); appended verbatim to the
  // /api/search fetch URL so the loaded pages keep all active filters.
  baseQuery: string;
}

export function InfiniteResults({ initialHits, initialCursor, baseQuery }: InfiniteResultsProps) {
  const [hits, setHits] = useState<SearchHit[]>(initialHits);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Guard against double-fires from IntersectionObserver and StrictMode.
  const inFlightRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (inFlightRef.current || !cursor) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(baseQuery);
      params.set("cursor", cursor);
      const res = await fetch(`/api/search?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: SearchHit[]; cursor: string | null };
      setHits((prev) => {
        // De-dup by productId in case the cursor window overlaps.
        const seen = new Set(prev.map((h) => h.productId));
        const merged = [...prev];
        for (const h of json.data) if (!seen.has(h.productId)) merged.push(h);
        return merged;
      });
      setCursor(json.cursor);
    } catch (e) {
      // Log technically, render generically — the user-visible error text
      // doesn't need to include the raw HTTP code or network stack snippet
      // (and on a French-locale page, an English error.message is jarring).
      if (typeof console !== "undefined") {
        console.error("[infinite-results] load_more_failed", (e as Error).message);
      }
      setError("error");
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [cursor, baseQuery]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      // Start fetching ~600px before the sentinel hits the viewport so the
      // next page is usually ready by the time the user reaches the bottom.
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  return (
    <>
      <ul
        className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-4 list-none p-0 m-0"
        aria-label={`${hits.length} annonce${hits.length === 1 ? "" : "s"}`}
      >
        {hits.map((h, i) => (
          <li key={h.productId}>
            <ProductCard hit={h} eager={i < 4} />
          </li>
        ))}
      </ul>
      {cursor && (
        <div ref={sentinelRef} className="mt-8 flex items-center justify-center" aria-hidden={!loading} lang="fr">
          {loading ? (
            <div className="text-xs text-ink-mute" role="status" aria-live="polite">
              Chargement…
            </div>
          ) : error ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              className="inline-flex items-center px-4 h-10 rounded-md border border-bad/40 bg-bad/10 text-sm sm:text-xs text-bad hover:bg-bad/20 active:bg-bad/25 transition"
            >
              Impossible de charger la suite — réessayer
            </button>
          ) : (
            // Reserve some height so the sentinel is observable even before
            // any items render below the fold.
            <div className="h-12" />
          )}
        </div>
      )}
      {!cursor && hits.length > initialHits.length && (
        <div className="mt-8 text-center text-xs text-ink-mute pt-6 border-t border-line-soft" lang="fr">
          Fin du catalogue · {hits.length.toLocaleString()} annonce{hits.length === 1 ? "" : "s"}
        </div>
      )}
    </>
  );
}
