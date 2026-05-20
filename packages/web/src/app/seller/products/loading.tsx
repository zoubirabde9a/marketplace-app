// Loading skeleton for /seller/products. Symmetric with the orders
// skeleton; paints the unified list shape immediately so the
// fan-out across all shops doesn't show as a blank screen.

export default function Loading(): React.JSX.Element {
  return (
    <section
      aria-busy="true"
      aria-label="Chargement des produits"
      className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-5xl mx-auto animate-pulse"
      lang="fr"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 space-y-2">
          <div className="h-7 sm:h-8 w-56 max-w-full rounded bg-bg-soft" />
          <div className="h-3 w-72 max-w-full rounded bg-bg-soft/70" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="h-9 w-24 rounded-md bg-bg-soft" />
          <div className="h-9 w-40 rounded-md bg-bg-soft" />
        </div>
      </header>

      <div className="mt-8 rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-6">
        {/* Filter tabs + search */}
        <div className="mb-4 flex flex-wrap gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 w-24 rounded-full bg-bg/40" />
          ))}
        </div>
        <div className="mb-3 h-9 w-full max-w-md rounded-full bg-bg/40" />

        <ul className="divide-y divide-line-soft">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-bg/40 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 rounded bg-bg/40" />
                <div className="h-3 w-1/2 rounded bg-bg/30" />
              </div>
              <div className="h-5 w-16 rounded bg-bg/40 shrink-0" />
              <div className="h-5 w-20 rounded-full bg-bg/40 shrink-0" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
