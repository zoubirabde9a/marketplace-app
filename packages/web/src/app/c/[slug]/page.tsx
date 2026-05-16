// Category landing route. Distinct from `/search?category=X`:
//   - /c/[slug]  = editorial landing — unique prose, FAQ, top brands,
//                  sample products. Optimized for ranking on category
//                  head-terms ("téléphones algérie", "informatique alger").
//                  Self-canonical, indexable.
//   - /search?category=X = filterable catalog tool — full listing with
//                  filters, sort, infinite scroll. Self-canonical, indexable.
// Both URLs serve a real purpose; both are linked from the home page and
// CategoryFooter. Internal links from product pages and other category
// landings point at /c/[slug] (the head-term page); the "View all listings"
// CTA on /c/[slug] points at /search?category=X.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { searchProducts } from "@/lib/api";
import { ProductGrid } from "@/components/ProductGrid";
import { jsonLdString } from "@/lib/jsonld";
import { FR_CATEGORY, humanizeCategorySlug, resolveCategorySlugs } from "@/lib/categories";
import { getCategoryContent } from "@/lib/categoryContent";
import { getCategoryBlogLinks } from "@/lib/categoryBlogLinks";
import { getPostBySlug } from "../../blog/posts";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

// Edge-cacheable like `/` and `/search` — category copy is static, only the
// sample product strip changes as the catalog rotates. 60s ISR aligns with
// home-page revalidation cadence.
export const revalidate = 60;

// Pre-render the known-good slugs at build time so first-paint is instant
// for the head categories. Unknown slugs still resolve via the fallback
// path (the route is `dynamicParams: true` by Next default).
export function generateStaticParams() {
  return Object.keys(FR_CATEGORY).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const human = humanizeCategorySlug(slug);
  // Probe the catalog to fold a real listing count into the SERP description.
  // Cached by Next's request-scoped fetch dedup with the page render below.
  let total: number | null = null;
  try {
    const r = await searchProducts({ category: resolveCategorySlugs(slug), limit: 1, noFacets: true });
    total = r.pagination?.totalEstimate ?? null;
  } catch {
    // Soft-fail: render meta without count.
  }
  const fmt = total != null ? total.toLocaleString("fr-FR") : null;
  const lowered = human.toLowerCase();
  const annonce = total === 1 ? "annonce" : "annonces";
  const title = `${human} en Algérie — annonces de vendeurs algériens`;
  const description = fmt
    ? `${fmt} ${annonce} ${lowered} de vendeurs algériens sur Teno Store. Neuf et occasion, prix en dinars (DZD), wilayas affichées. Catalogue actualisé en continu.`
    : `Annonces ${lowered} de vendeurs algériens sur Teno Store. Neuf et occasion, prix en dinars (DZD). Catalogue actualisé en continu.`;
  const url = `${SITE_URL}/c/${slug}`;
  return {
    title,
    description,
    alternates: {
      canonical: `/c/${slug}`,
      // Re-declare hreflang here. Next.js replaces the layout-level
      // `alternates` wholesale on child pages — without this the page
      // ships no hreflang, dropping the country/language targeting
      // signal Google uses to route fr-DZ users to fr-DZ pages.
      languages: {
        "fr-DZ": `${SITE_URL}/c/${slug}`,
        "ar-DZ": `${SITE_URL}/c/${slug}`,
        "x-default": `${SITE_URL}/c/${slug}`,
      },
    },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      siteName: "Teno Store",
      locale: "fr_DZ",
      alternateLocale: ["ar_DZ", "en_US"],
    },
    twitter: { card: "summary_large_image", title, description },
    // Empty category pages: even when FR_CATEGORY has curated prose (so the
    // notFound() below doesn't fire), an indexable /c/<slug> with zero
    // listings is a textbook soft-404 from Google's perspective and a
    // dead-navigation hit for any AI agent that follows
    // agents.json.subcategory_slugs. iter-47 audit found 13 of 19 advertised
    // bare-slug subcategories have 0 listings (the bulk-imported catalog
    // uses compound slugs like `electronique_electromenager` rather than
    // bare `electromenager`). Noindex the empty case while keeping `follow`
    // so internal links still pass equity to live category pages. Skip the
    // noindex when total is null (API failure) — that's transient.
    robots:
      total === 0
        ? { index: false, follow: true }
        : {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
          },
  };
}

export default async function CategoryLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const human = humanizeCategorySlug(slug);
  const content = getCategoryContent(slug);

  // Sample products — small batch, sorted newest, no facets (keeps the API
  // call cheap; this is a landing page, not the full catalog).
  let sample: Awaited<ReturnType<typeof searchProducts>>["data"] = [];
  let total: number | null = null;
  try {
    const r = await searchProducts({
      category: resolveCategorySlugs(slug),
      sort: "newest",
      limit: 12,
      noFacets: true,
    });
    sample = r.data ?? [];
    total = r.pagination?.totalEstimate ?? null;
  } catch {
    // Soft-fail. Page still renders prose + FAQ even if the strip is empty.
  }

  // If the slug returns zero products AND we don't have curated content for
  // it, this is a thin / soft-404 candidate — refuse to render rather than
  // letting Google index an empty page.
  if (total === 0 && !FR_CATEGORY[slug.toLowerCase()]) notFound();

  const url = `${SITE_URL}/c/${slug}`;
  const annonce = total === 1 ? "annonce" : "annonces";
  const fmtCount = total != null ? total.toLocaleString("fr-FR") : null;

  // CollectionPage with embedded ItemList — same shape as /search emits for
  // single-category slices, so Google sees /c/X and /search?category=X as
  // siblings rather than duplicates (each canonical-self, each with its own
  // unique prose + FAQ vs filter-tool framing).
  const collectionPageJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": url,
    url,
    name: `${human} sur Teno Store`,
    description: fmtCount
      ? `${fmtCount} ${annonce} ${human.toLowerCase()} de vendeurs algériens sur Teno Store.`
      : `Annonces ${human.toLowerCase()} sur Teno Store.`,
    isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website` },
    // Cross-link to the canonical Organization. iter-64: every CollectionPage
    // should declare who publishes it so AI panels can attribute the
    // category landing to the marketplace entity.
    publisher: { "@id": `${SITE_URL}/#organization` },
    inLanguage: "fr",
    about: {
      "@type": "ProductGroup",
      name: human,
      productGroupID: slug,
    },
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Catégories", item: `${SITE_URL}/search` },
      { "@type": "ListItem", position: 3, name: human, item: url },
    ],
  };
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    inLanguage: "fr",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    // Speakable: tells voice/AI search engines which spans are safe to read
    // aloud as a featured snippet. Targets the FAQ heading + the <dl> that
    // follows it — matches the same selector pattern /about already uses.
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: ["#faq-heading", "#faq-heading ~ dl"],
    },
    mainEntity: content.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="pt-8 pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(collectionPageJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(faqJsonLd) }}
      />
      <nav aria-label="Fil d'Ariane" className="text-sm text-ink-mute mb-4">
        <Link href="/" className="hover:text-ink">Accueil</Link>
        <span aria-hidden> / </span>
        <Link href="/search" className="hover:text-ink">Catégories</Link>
        <span aria-hidden> / </span>
        <span className="text-ink-soft">{human}</span>
      </nav>
      <header className="mb-8 max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight text-ink mb-3">
          {human} en Algérie
        </h1>
        {fmtCount && (
          <p className="text-sm text-ink-mute mb-4">
            {fmtCount} {annonce} actuellement actives · catalogue actualisé en continu
          </p>
        )}
        <div className="space-y-3 text-ink-soft leading-relaxed">
          {content.intro.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/search?${resolveCategorySlugs(slug).map(s => `category=${encodeURIComponent(s)}`).join("&")}`}
            className="inline-flex items-center px-4 py-2 rounded-md bg-accent text-bg font-medium shadow-glow hover:brightness-110 transition"
          >
            Voir toutes les {annonce} →
          </Link>
        </div>
      </header>

      {sample.length > 0 && (
        <section aria-labelledby="sample-heading" className="mb-12">
          <div className="flex items-end justify-between mb-4">
            <h2 id="sample-heading" className="text-xl font-medium text-ink">
              Annonces récentes
            </h2>
            <Link
              href={`/search?${resolveCategorySlugs(slug).map(s => `category=${encodeURIComponent(s)}`).join("&")}&sort=newest`}
              className="text-sm text-accent hover:underline"
            >
              Voir plus →
            </Link>
          </div>
          <ProductGrid hits={sample} />
        </section>
      )}

      {(() => {
        const blogLinks = getCategoryBlogLinks(slug)
          .map((s) => getPostBySlug(s))
          .filter((p): p is NonNullable<typeof p> => Boolean(p));
        if (blogLinks.length === 0) return null;
        return (
          <section aria-labelledby="related-blog-heading" className="mb-12">
            <h2 id="related-blog-heading" className="text-xl font-medium text-ink mb-4">
              Articles à lire
            </h2>
            <ul className="space-y-3">
              {blogLinks.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/blog/${p.slug}`}
                    className="group block p-4 rounded-lg border border-line-soft hover:border-accent transition"
                  >
                    <div className="text-xs text-ink-mute mb-1">{p.category} · {p.readingMinutes} min de lecture</div>
                    <div className="text-ink font-medium group-hover:text-accent">{p.title}</div>
                    <div className="text-sm text-ink-soft mt-1">{p.excerpt}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

      {content.related.length > 0 && (
        <section aria-labelledby="related-heading" className="mb-12">
          <h2 id="related-heading" className="text-xl font-medium text-ink mb-4">
            Catégories liées
          </h2>
          <div className="flex flex-wrap gap-2">
            {content.related.map((r) => (
              <Link
                key={r}
                href={`/c/${r}`}
                className="inline-flex items-center px-3 py-1.5 rounded-md bg-bg-elev border border-line-soft text-sm text-ink-soft hover:text-ink hover:border-accent transition"
              >
                {humanizeCategorySlug(r)}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="faq-heading" className="max-w-3xl">
        <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight text-ink mb-4">
          Questions fréquentes — {human.toLowerCase()}
        </h2>
        <dl className="space-y-5">
          {content.faq.map(({ q, a }) => (
            <div key={q}>
              <dt className="text-base font-medium text-ink mb-1">{q}</dt>
              <dd className="leading-relaxed text-ink-soft">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
