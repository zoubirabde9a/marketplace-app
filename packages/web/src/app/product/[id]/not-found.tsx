import type { Metadata } from "next";
import Link from "next/link";
import { humanizeCategorySlug } from "@/lib/categories";

// Next 15 streams the response head before notFound() can set a 404 status,
// so this UI is currently served with HTTP 200 — a soft-404 in Google's eyes.
// Until that's resolved upstream, a hard noindex keeps crawlers from indexing
// the placeholder page.
export const metadata: Metadata = {
  title: "Annonce introuvable",
  robots: { index: false, follow: true },
};

// Mirrors the global /not-found recovery chips so a product-specific 404
// doesn't dead-end the user. Most product-page 404s come from listings the
// seller pulled — head-category chips are the natural fallback because the
// buyer was probably shopping inside one of them.
const RECOVERY_CATEGORIES = [
  "telephones",
  "informatique",
  "electronique_electromenager",
  "vetements_mode",
  "automobiles_vehicules",
  "immobilier",
];

export default function ProductNotFound() {
  return (
    <div className="py-12 sm:py-24 px-4 max-w-2xl mx-auto text-center">
      <p className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-3">404</p>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3 break-words">Annonce introuvable.</h1>
      <p className="text-ink-soft mb-8">
        Elle a peut-être été retirée par le vendeur, ou n&rsquo;a jamais existé. Continuez votre recherche depuis l&rsquo;une des destinations ci-dessous.
      </p>

      <div className="flex flex-wrap justify-center gap-3 mb-10">
        <Link
          href="/search"
          className="inline-flex h-11 sm:h-10 px-4 items-center rounded-md bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 active:bg-accent/30 transition"
        >
          Parcourir le catalogue
        </Link>
        <Link
          href="/"
          className="inline-flex h-11 sm:h-10 px-4 items-center rounded-md bg-bg-elev text-ink border border-line-soft hover:border-accent active:border-accent active:bg-bg-soft transition"
        >
          Accueil
        </Link>
      </div>

      <div>
        <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-3">
          Catégories populaires
        </h2>
        <div className="flex flex-wrap justify-center gap-2">
          {RECOVERY_CATEGORIES.map((slug) => (
            <Link
              key={slug}
              href={`/c/${slug}`}
              className="inline-flex h-9 sm:h-8 px-3.5 sm:px-3 items-center rounded-full bg-bg-soft border border-line-soft text-sm sm:text-xs text-ink-soft hover:border-accent/40 hover:text-ink active:border-accent/40 active:text-ink transition"
            >
              {humanizeCategorySlug(slug)}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
