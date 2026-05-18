import Link from "next/link";

export function EmptyState({
  title,
  hint,
  q,
  hasFilters,
  showSellCta,
  fuzzyAlreadyOn,
}: {
  title: string;
  hint: string;
  q?: string;
  hasFilters?: boolean;
  showSellCta?: boolean;
  /** When the current search already used fuzzy=true, hide the "Try fuzzy match" CTA. */
  fuzzyAlreadyOn?: boolean;
}) {
  const showReset = Boolean(q) || Boolean(hasFilters);
  // Site default locale is fr_DZ; chrome stays in French for consistency
  // with the rest of the page. Search empty-states are the only place
  // this shared component renders today (see EmptyState consumer audit
  // 2026-05-12 — only /search uses it).
  const resetLabel = q ? "Effacer la recherche" : "Effacer les filtres";
  // When the visitor searched for something with no results, offer a fuzzy
  // retry — the underlying API's text matcher misses non-ASCII queries
  // (e.g. "téléphone" returns 0 even though "phone" returns 2 with fuzzy).
  const showFuzzyCta = Boolean(q) && !fuzzyAlreadyOn;
  return (
    <div className="rounded-2xl border border-dashed border-line bg-bg-soft/50 px-4 sm:px-8 py-10 sm:py-16 text-center">
      <div className="mx-auto w-12 h-12 rounded-xl bg-bg-elev border border-line-soft flex items-center justify-center text-ink-soft mb-4">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </div>
      <h2 className="text-lg font-semibold text-ink mb-1">{title}</h2>
      <p className="text-sm text-ink-soft max-w-md mx-auto">{hint}</p>
      {q && (
        <p className="text-xs text-ink-mute mt-4 font-mono break-all">
          requête : <span className="text-ink-soft">{q}</span>
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-2 justify-center">
        {showFuzzyCta && (
          <Link
            href={`/search?q=${encodeURIComponent(q!)}&fuzzy=true`}
            className="inline-flex px-4 h-11 sm:h-9 items-center rounded-md bg-accent/15 text-accent border border-accent/30 text-sm hover:bg-accent/25 active:bg-accent/30 transition"
          >
            Essayer la recherche approximative
          </Link>
        )}
        {showReset && (
          <Link href="/search" className="inline-flex px-4 h-11 sm:h-9 items-center rounded-md bg-bg-elev border border-line text-ink-soft text-sm hover:border-accent/40 hover:text-ink active:border-accent/40 active:text-ink transition">
            {resetLabel}
          </Link>
        )}
        {showSellCta && (
          <Link href="/seller" className="inline-flex px-4 h-11 sm:h-9 items-center rounded-md bg-accent/15 text-accent border border-accent/30 text-sm hover:bg-accent/25 active:bg-accent/30 transition">
            Vendre sur Teno Store →
          </Link>
        )}
      </div>
    </div>
  );
}
