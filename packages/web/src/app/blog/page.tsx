import type { Metadata } from "next";
import Link from "next/link";
import { jsonLdString } from "@/lib/jsonld";
import { BLOG_POSTS } from "./posts";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "Blog — guides d'achat et conseils vendeurs",
  description:
    "Le blog Teno Store — guides d'achat pour acheteurs algériens, conseils pour vendeurs, tendances du marché. Tout en français, en dinars algériens (DZD).",
  alternates: {
    canonical: "/blog",
    // Re-declare hreflang — Next.js replaces layout-level `alternates`
    // wholesale on child pages, so without this /blog ships no language
    // signal.
    languages: {
      "fr-DZ": `${SITE_URL}/blog`,
      "ar-DZ": `${SITE_URL}/blog`,
      "x-default": `${SITE_URL}/blog`,
    },
    // Declare the RSS feed as an alternate representation. Browsers and
    // feed readers auto-discover via this <link>; AI crawlers (ChatGPT,
    // Perplexity, Bing Chat) also follow RSS for content discovery.
    types: { "application/rss+xml": `${SITE_URL}/blog/rss.xml` },
  },
  openGraph: {
    title: "Blog Teno Store — guides d'achat et conseils vendeurs",
    description:
      "Guides d'achat et conseils vendeurs pour le marché algérien — téléphones, électroménager, mode, véhicules. Prix en DZD, conseils pratiques.",
    siteName: "Teno Store",
    locale: "fr_DZ",
    alternateLocale: ["ar_DZ"],
    type: "website",
    url: `${SITE_URL}/blog`,
  },
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default function BlogIndexPage() {
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${SITE_URL}/blog`,
    url: `${SITE_URL}/blog`,
    name: "Blog Teno Store",
    description:
      "Guides d'achat et conseils vendeurs pour le marketplace algérien Teno Store.",
    inLanguage: "fr",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    blogPost: BLOG_POSTS.map((p) => ({
      "@type": "BlogPosting",
      "@id": `${SITE_URL}/blog/${p.slug}`,
      url: `${SITE_URL}/blog/${p.slug}`,
      headline: p.title,
      description: p.description,
      datePublished: p.datePublished,
      dateModified: p.dateModified,
      inLanguage: "fr",
    })),
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
    ],
  };
  return (
    <div className="max-w-4xl mx-auto pt-6 sm:pt-12 pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(collectionJsonLd) }}
      />
      <header className="mb-8 sm:mb-10">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink mb-3">Blog Teno Store</h1>
        <p className="text-base sm:text-lg text-ink-soft leading-relaxed max-w-2xl">
          Guides d&rsquo;achat pour acheteurs algériens, conseils pratiques
          pour vendeurs, et analyses du marché. Tout en français, prix en
          dinars algériens (DZD).
        </p>
      </header>
      <ul className="space-y-6 sm:space-y-8">
        {BLOG_POSTS.map((p) => (
          <li key={p.slug} className="border-b border-line-soft pb-6 sm:pb-8 last:border-b-0">
            <article>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-mute mb-2">
                <span className="px-2 py-0.5 rounded-md bg-bg-elev border border-line-soft">
                  {p.category}
                </span>
                <time dateTime={p.datePublished}>{formatDate(p.datePublished)}</time>
                <span>·</span>
                <span>{p.readingMinutes} min de lecture</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink mb-2 break-words">
                <Link href={`/blog/${p.slug}`} className="hover:text-accent active:text-accent transition">
                  {p.title}
                </Link>
              </h2>
              <p className="text-ink-soft leading-relaxed mb-3">{p.excerpt}</p>
              <Link
                href={`/blog/${p.slug}`}
                className="inline-flex items-center h-9 sm:h-auto text-accent hover:underline active:underline active:underline text-sm font-medium"
              >
                Lire l&rsquo;article →
              </Link>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
