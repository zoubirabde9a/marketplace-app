// Loading skeleton for /seller/orders/[id]. The detail page fans out
// across every shop the seller owns (there's no /v1/orders/:id endpoint
// yet, so we scan listSellerOrders per shop until we find the match).
// For a multi-shop seller this is enough latency that an immediate
// skeleton makes navigation feel snappy instead of stuck.
//
// Shape only — mirror the real layout closely enough that the actual
// content can paint over without a layout jolt.

export default function Loading(): React.JSX.Element {
  return (
    <section
      aria-busy="true"
      aria-label="Chargement de la commande"
      className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-3xl mx-auto animate-pulse"
      lang="fr"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 space-y-2">
          <div className="h-3 w-40 rounded bg-bg-soft/70" />
          <div className="h-7 sm:h-8 w-56 max-w-full rounded bg-bg-soft" />
        </div>
        <div className="h-9 w-28 rounded-md bg-bg-soft shrink-0" />
      </header>

      <article className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-5 sm:p-8 space-y-6">
        {/* Shop name + status row */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="h-3 w-20 rounded bg-bg/40" />
            <div className="h-5 w-44 rounded bg-bg/60" />
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
          <div className="h-4 w-44 rounded bg-bg/40" />
        </div>

        {/* Lines */}
        <div className="pt-4 border-t border-line-soft space-y-3">
          <div className="h-3 w-28 rounded bg-bg/40" />
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-10 h-7 rounded-md bg-bg/40 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 rounded bg-bg/40" />
                <div className="h-3 w-1/3 rounded bg-bg/30" />
              </div>
              <div className="h-4 w-16 rounded bg-bg/40 shrink-0" />
            </div>
          ))}
        </div>

        {/* Total */}
        <div className="pt-4 border-t border-line-soft flex items-baseline justify-between">
          <div className="h-3 w-12 rounded bg-bg/40" />
          <div className="h-7 w-28 rounded bg-bg/60" />
        </div>
      </article>
    </section>
  );
}
