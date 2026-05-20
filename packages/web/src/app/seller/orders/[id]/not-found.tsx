// Custom 404 for /seller/orders/[id]. Fires when the page-level scan
// across every shop the seller owns finds no matching order — either
// the URL is mistyped, the seller is signed in as the wrong account,
// or the order was soft-deleted / belongs to a different seller. A
// friendly fallback with a single CTA back to the unified list is
// nicer than the generic 404 chrome.
//
// Next routes here via notFound() from the page, so this is a server
// component — no client work required.

import Link from "next/link";

export default function OrderNotFound(): React.JSX.Element {
  return (
    <section
      aria-labelledby="not-found-heading"
      className="pt-10 sm:pt-16 pb-12 sm:pb-24 max-w-md mx-auto text-center"
      lang="fr"
    >
      <h1
        id="not-found-heading"
        className="text-2xl sm:text-3xl font-semibold tracking-tight"
      >
        Commande introuvable
      </h1>
      <p className="mt-3 text-sm text-ink-soft">
        Cette commande n’existe pas, a été supprimée, ou appartient à un autre
        compte vendeur. Vérifiez le numéro ou retournez à la liste de vos
        commandes.
      </p>
      <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
        <Link
          href="/seller/orders"
          className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center rounded-md bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition"
        >
          ← Toutes les commandes
        </Link>
        <Link
          href="/seller/dashboard"
          className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
        >
          Tableau de bord
        </Link>
      </div>
    </section>
  );
}
