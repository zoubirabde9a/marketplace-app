// Loading skeleton for /seller/dashboard. Next renders this immediately
// during client-side navigation while the page's server fetches
// (listMySellers + per-shop listProductsBySeller + listSellerOrders)
// resolve. A multi-shop seller on a cold cache could wait 1–2 seconds
// otherwise — better to ship the page outline so they see the shape
// snap into place instead of a blank screen.
//
// Shapes only — width and rough height of the real elements. No live
// counts, no real text. animate-pulse is the visual cue that the
// screen is provisional.

export default function Loading(): React.JSX.Element {
  return (
    <section
      aria-busy="true"
      aria-label="Chargement du tableau de bord"
      className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-5xl mx-auto animate-pulse"
      lang="fr"
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="h-7 sm:h-8 w-64 max-w-full rounded bg-bg-soft" />
          <div className="mt-3 h-3 w-72 max-w-full rounded bg-bg-soft/70" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="h-9 w-44 rounded-md bg-bg-soft" />
          <div className="h-9 w-20 rounded-md bg-bg-soft" />
        </div>
      </header>

      {/* One shop placeholder card. The real page renders one of these
          per shop; we render a single one since we don't know the
          count yet (and rendering N=1 keeps the skeleton small enough
          that the real content can paint over it without a layout
          jolt). */}
      <article className="mt-10 rounded-2xl border border-line-soft bg-bg-soft/60">
        <header className="p-4 sm:p-6 border-b border-line-soft flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="min-w-0 sm:flex-1 space-y-2">
            <div className="h-6 w-48 max-w-full rounded bg-bg/60" />
            <div className="h-3 w-60 max-w-full rounded bg-bg/40" />
            <div className="h-3 w-40 max-w-full rounded bg-bg/40" />
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="h-9 w-36 rounded-md bg-bg/60" />
            <div className="h-9 w-32 rounded-md bg-bg/40" />
          </div>
        </header>
        <section className="p-4 sm:p-6 border-b border-line-soft space-y-3">
          <div className="h-3 w-24 rounded bg-bg/40" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="py-2 flex items-start gap-3">
              <div className="w-10 h-10 rounded bg-bg/40 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 rounded bg-bg/40" />
                <div className="h-3 w-1/2 rounded bg-bg/30" />
              </div>
              <div className="h-4 w-16 rounded bg-bg/40" />
            </div>
          ))}
        </section>
        <section className="p-4 sm:p-6 space-y-3">
          <div className="h-3 w-24 rounded bg-bg/40" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="py-2 flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-bg/40 shrink-0" />
              <div className="flex-1 h-4 rounded bg-bg/40" />
              <div className="h-5 w-20 rounded-full bg-bg/40" />
            </div>
          ))}
        </section>
      </article>
    </section>
  );
}
