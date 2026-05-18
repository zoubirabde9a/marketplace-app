import type { Metadata } from "next";
import Link from "next/link";
import { humanizeCategorySlug } from "@/lib/categories";

export const metadata: Metadata = {
  title: "Page introuvable",
  robots: { index: false, follow: true },
};

// Top-traffic category landings — keep the user in the catalog when their
// URL didn't resolve instead of dead-ending on a single "back to /search"
// link. Slugs are stable; matches the head categories from FR_CATEGORY.
const RECOVERY_CATEGORIES = [
  "telephones",
  "informatique",
  "electronique_electromenager",
  "vetements_mode",
  "automobiles_vehicules",
  "immobilier",
];

export default function NotFound() {
  return (
    <div className="py-12 sm:py-24 px-4 max-w-2xl mx-auto text-center">
      <p className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-3">404</p>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3 break-words">Cette page est vide.</h1>
      <p className="text-ink-soft mb-8">
        L&rsquo;annonce ou la page que vous cherchiez n&rsquo;est plus en ligne, ou n&rsquo;a jamais existé. Essayez l&rsquo;une des destinations ci-dessous.
      </p>

      <div className="flex flex-wrap justify-center gap-3 mb-10">
        <Link
          href="/"
          className="inline-flex h-11 sm:h-10 px-4 items-center rounded-md bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 active:bg-accent/30 transition"
        >
          Accueil
        </Link>
        <Link
          href="/search"
          className="inline-flex h-11 sm:h-10 px-4 items-center rounded-md bg-bg-elev text-ink border border-line-soft hover:border-accent active:border-accent active:bg-bg-soft transition"
        >
          Parcourir le catalogue
        </Link>
        <Link
          href="/blog"
          className="inline-flex h-11 sm:h-10 px-4 items-center rounded-md bg-bg-elev text-ink border border-line-soft hover:border-accent active:border-accent active:bg-bg-soft transition"
        >
          Blog
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
