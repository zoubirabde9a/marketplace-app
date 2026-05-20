export default function Loading(): React.JSX.Element {
  return (
    <section
      aria-busy="true"
      aria-label="Chargement des clients"
      className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-5xl mx-auto animate-pulse"
      lang="fr"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 space-y-2">
          <div className="h-7 sm:h-8 w-40 max-w-full rounded bg-bg-soft" />
          <div className="h-3 w-64 max-w-full rounded bg-bg-soft/70" />
        </div>
        <div className="h-9 w-40 rounded-md bg-bg-soft shrink-0" />
      </header>

      <div className="mt-8 rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-6">
        <ul className="divide-y divide-line-soft">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="py-3 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-40 rounded bg-bg/40" />
                <div className="h-3 w-56 rounded bg-bg/30" />
                <div className="h-3 w-32 rounded bg-bg/30" />
              </div>
              <div className="h-7 w-24 rounded bg-bg/40 shrink-0" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
