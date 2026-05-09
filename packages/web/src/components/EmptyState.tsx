import Link from "next/link";

export function EmptyState({
  title,
  hint,
  q,
  hasFilters,
  showSellCta,
}: {
  title: string;
  hint: string;
  q?: string;
  hasFilters?: boolean;
  showSellCta?: boolean;
}) {
  const showReset = Boolean(q) || Boolean(hasFilters);
  const resetLabel = q ? "Clear search" : "Clear filters";
  return (
    <div className="rounded-2xl border border-dashed border-line bg-bg-soft/50 px-8 py-16 text-center">
      <div className="mx-auto w-12 h-12 rounded-xl bg-bg-elev border border-line-soft flex items-center justify-center text-ink-soft mb-4">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </div>
      <h2 className="text-lg font-semibold text-ink mb-1">{title}</h2>
      <p className="text-sm text-ink-soft max-w-md mx-auto">{hint}</p>
      {q && (
        <p className="text-xs text-ink-mute mt-4 font-mono">
          query: <span className="text-ink-soft">{q}</span>
        </p>
      )}
      {showReset && (
        <Link href="/search" className="inline-flex mt-6 px-4 h-9 items-center rounded-md bg-accent/15 text-accent border border-accent/30 text-sm hover:bg-accent/25 transition">
          {resetLabel}
        </Link>
      )}
      {showSellCta && (
        <Link href="/seller" className="inline-flex mt-6 px-4 h-9 items-center rounded-md bg-accent/15 text-accent border border-accent/30 text-sm hover:bg-accent/25 transition">
          Sell on Teno Store →
        </Link>
      )}
    </div>
  );
}
