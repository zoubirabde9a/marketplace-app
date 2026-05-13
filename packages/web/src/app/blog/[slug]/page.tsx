import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { jsonLdString } from "@/lib/jsonld";
import { BLOG_POSTS, getAdjacentPosts, getPostBySlug } from "../posts";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "Article introuvable" };
  const url = `${SITE_URL}/blog/${post.slug}`;
  const ogImage = `${url}/opengraph-image`;
  return {
    title: post.title,
    description: post.description,
    alternates: {
      canonical: `/blog/${post.slug}`,
      // Next.js replaces layout-level `alternates` wholesale when a child
      // sets one. Re-declare hreflang so child pages keep the fr-DZ /
      // x-default language signal.
      languages: {
        "fr-DZ": `${SITE_URL}/blog/${post.slug}`,
        "x-default": `${SITE_URL}/blog/${post.slug}`,
      },
    },
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: "article",
      locale: "fr_DZ",
      siteName: "Teno Store",
      publishedTime: post.datePublished,
      modifiedTime: post.dateModified,
      // Authors as URL strings — Next emits article:author with the URL. We
      // attribute every post to the brand (no per-author bylines yet); point
      // at /about so social platforms have a real landing if a reader clicks
      // the byline.
      authors: [`${SITE_URL}/about`],
      // article:section feeds the category breadcrumb on Facebook/LinkedIn
      // share previews. Mirrors the same value as the JSON-LD articleSection.
      section: post.category,
      images: [{ url: ogImage, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [ogImage],
    },
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();
  const { prev, next } = getAdjacentPosts(slug);
  const url = `${SITE_URL}/blog/${post.slug}`;
  // `image` is REQUIRED for Article rich-result eligibility per Google's
  // structured-data docs. Use the dynamic /opengraph-image route we already
  // generate (1200×630 PNG, branded). Without this Google rejects the
  // Article enhancement and falls back to a plain blue link in SERP.
  const ogImage = `${url}/opengraph-image`;
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": url,
    url,
    headline: post.title,
    description: post.description,
    image: [ogImage],
    datePublished: post.datePublished,
    dateModified: post.dateModified,
    inLanguage: "fr",
    isPartOf: { "@id": `${SITE_URL}/blog` },
    mainEntityOfPage: url,
    publisher: { "@id": `${SITE_URL}/#organization` },
    author: { "@id": `${SITE_URL}/#organization` },
    articleSection: post.category,
    wordCount: post.readingMinutes * 200,
    // Speakable annotation: tells Google Assistant / Bing Chat voice mode /
    // Perplexity audio / ChatGPT voice which parts of the page are safe to
    // read aloud as a featured snippet. We target the H1 + lead paragraph
    // (the post's excerpt block) — the natural "elevator pitch" surface
    // that maps cleanly to a 30-60 sec audio answer.
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: ["#article-headline", "#article-lead"],
    },
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
      { "@type": "ListItem", position: 3, name: post.title, item: url },
    ],
  };
  return (
    <article className="max-w-3xl mx-auto pt-12 pb-24 blog-prose text-ink-soft">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(articleJsonLd) }}
      />
      <nav aria-label="Fil d'Ariane" className="text-sm text-ink-mute mb-6">
        <Link href="/" className="hover:text-ink">Accueil</Link>
        <span aria-hidden> / </span>
        <Link href="/blog" className="hover:text-ink">Blog</Link>
      </nav>
      <header className="mb-8">
        <div className="flex items-center gap-3 text-xs text-ink-mute mb-3">
          <span className="px-2 py-0.5 rounded-md bg-bg-elev border border-line-soft">
            {post.category}
          </span>
          <time dateTime={post.datePublished}>{formatDate(post.datePublished)}</time>
          <span>·</span>
          <span>{post.readingMinutes} min de lecture</span>
        </div>
        <h1 id="article-headline" className="text-4xl font-semibold tracking-tight text-ink leading-tight">
          {post.title}
        </h1>
        {/* Lead paragraph — speakable target. Renders the excerpt so the
            voice-readable surface matches what a human-skim reader would
            also see first. Without this, the Speakable cssSelector below
            points at nothing. */}
        <p id="article-lead" className="mt-4 text-lg text-ink-soft leading-relaxed">
          {post.excerpt}
        </p>
      </header>
      <div className="space-y-5 leading-relaxed">
        <post.Body />
      </div>
      <footer className="mt-16 pt-8 border-t border-line-soft">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
          {prev ? (
            <Link
              href={`/blog/${prev.slug}`}
              className="block p-4 rounded-lg border border-line-soft hover:border-accent transition"
            >
              <div className="text-xs text-ink-mute mb-1">← Article précédent</div>
              <div className="text-ink font-medium">{prev.title}</div>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`/blog/${next.slug}`}
              className="block p-4 rounded-lg border border-line-soft hover:border-accent transition sm:text-right"
            >
              <div className="text-xs text-ink-mute mb-1">Article suivant →</div>
              <div className="text-ink font-medium">{next.title}</div>
            </Link>
          ) : (
            <span />
          )}
        </div>
        <div className="text-sm text-ink-soft">
          <Link href="/search" className="text-accent hover:underline">
            Parcourir le catalogue Teno Store →
          </Link>
        </div>
      </footer>
    </article>
  );
}
