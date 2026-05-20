// Loading skeleton for /seller/contact. Fetches listMySellers on every
// render to resolve which shop's contact form to load; on a cold cache
// that was a blank flash before this skeleton landed. Completes the
// loading-state convention across every server-fetching seller page.
//
// Shape mirrors the real form: back link, title, description, then
// four input rows (phone, WhatsApp, website, save button row).

export default function Loading(): React.JSX.Element {
  return (
    <section
      aria-busy="true"
      aria-label="Chargement du formulaire de coordonnées"
      className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-2xl mx-auto animate-pulse"
      lang="fr"
    >
      <div className="h-4 w-40 rounded bg-bg-soft/70" />
      <div className="mt-3 h-7 sm:h-8 w-64 max-w-full rounded bg-bg-soft" />
      <div className="mt-3 h-3 w-72 max-w-full rounded bg-bg-soft/70" />
      <div className="mt-1 h-3 w-80 max-w-full rounded bg-bg-soft/70" />

      <div className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-6 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-24 rounded bg-bg/40" />
            <div className="h-10 rounded-lg bg-bg/40" />
          </div>
        ))}
        <div className="pt-2">
          <div className="h-10 w-32 rounded-lg bg-bg/60" />
        </div>
      </div>
    </section>
  );
}
