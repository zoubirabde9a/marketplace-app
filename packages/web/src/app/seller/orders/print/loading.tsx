// Loading skeleton for /seller/orders/print. The bulk-print page fans
// out listSellerOrders across every shop the seller owns to assemble
// the actionable slip stack — a multi-shop cold-cache seller saw a
// blank screen for a beat before the slips landed. This paints the
// page shape immediately so navigation feels snappy.
//
// Three slip-shaped placeholders is enough to communicate "this is the
// stacked-slip page"; rendering more would just waste DOM nodes since
// the real content paints over the moment it arrives.

export default function Loading(): React.JSX.Element {
  return (
    <section
      aria-busy="true"
      aria-label="Chargement des bons à imprimer"
      className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-3xl mx-auto animate-pulse"
      lang="fr"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 space-y-2">
          <div className="h-3 w-40 rounded bg-bg-soft/70" />
          <div className="h-7 sm:h-8 w-48 max-w-full rounded bg-bg-soft" />
          <div className="h-3 w-72 max-w-full rounded bg-bg-soft/70" />
        </div>
        <div className="h-9 w-28 rounded-md bg-bg-soft shrink-0" />
      </header>

      <div className="mt-6 space-y-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <article
            key={i}
            className="rounded-2xl border border-line-soft bg-bg-soft/60 p-5 sm:p-8 space-y-6"
          >
            {/* Shop name + status row */}
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="h-3 w-20 rounded bg-bg/40" />
                <div className="h-5 w-44 rounded bg-bg/60" />
                <div className="h-4 w-32 rounded bg-bg/40" />
              </div>
              <div className="space-y-2 text-right">
                <div className="h-3 w-16 ml-auto rounded bg-bg/40" />
                <div className="h-5 w-32 rounded bg-bg/40" />
              </div>
            </div>

            {/* Customer block */}
            <div className="pt-4 border-t border-line-soft space-y-2">
              <div className="h-3 w-24 rounded bg-bg/40" />
              <div className="h-5 w-52 rounded bg-bg/60" />
              <div className="h-4 w-40 rounded bg-bg/40" />
            </div>

            {/* Lines */}
            <div className="pt-4 border-t border-line-soft space-y-3">
              <div className="h-3 w-28 rounded bg-bg/40" />
              <div className="flex items-center gap-3">
                <div className="w-10 h-7 rounded-md bg-bg/40 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-bg/40" />
                  <div className="h-3 w-1/3 rounded bg-bg/30" />
                </div>
                <div className="h-4 w-16 rounded bg-bg/40 shrink-0" />
              </div>
            </div>

            {/* Total */}
            <div className="pt-4 border-t border-line-soft flex items-baseline justify-between">
              <div className="h-3 w-12 rounded bg-bg/40" />
              <div className="h-7 w-28 rounded bg-bg/60" />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
