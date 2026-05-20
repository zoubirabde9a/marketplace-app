// Loading skeleton for /seller/orders. Same idea as the dashboard
// loading state: paint the page shape immediately during navigation
// while the server fans out listSellerOrders across every shop. Eight
// row placeholders is a comfortable middle ground — covers the
// visible viewport on most screens and disappears as soon as real
// content paints over.

export default function Loading(): React.JSX.Element {
  return (
    <section
      aria-busy="true"
      aria-label="Chargement des commandes"
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

      {/* Three stat tiles. */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-line-soft bg-bg-soft/60 px-4 py-3 space-y-2">
            <div className="h-3 w-24 rounded bg-bg/40" />
            <div className="h-7 w-20 rounded bg-bg/60" />
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-6">
        {/* Search input + status tabs row. */}
        <div className="mb-3 h-9 w-full max-w-md rounded-full bg-bg/40" />
        <div className="mb-4 flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 w-24 rounded-full bg-bg/40" />
          ))}
        </div>

        {/* Order rows. */}
        <ul className="divide-y divide-line-soft">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="py-3 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-40 rounded bg-bg/40" />
                <div className="h-3 w-56 rounded bg-bg/30" />
                <div className="h-5 w-72 max-w-full rounded bg-bg/30" />
              </div>
              <div className="h-5 w-20 rounded bg-bg/40 shrink-0" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
