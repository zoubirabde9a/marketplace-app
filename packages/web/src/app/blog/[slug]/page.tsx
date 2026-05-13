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
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: "article",
      locale: "fr_DZ",
      publishedTime: post.datePublished,
      modifiedTime: post.dateModified,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
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
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": url,
    url,
    headline: post.title,
    description: post.description,
    datePublished: post.datePublished,
    dateModified: post.dateModified,
    inLanguage: "fr",
    isPartOf: { "@id": `${SITE_URL}/blog` },
    mainEntityOfPage: url,
    publisher: { "@id": `${SITE_URL}/#organization` },
    author: { "@id": `${SITE_URL}/#organization` },
    articleSection: post.category,
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
        <h1 className="text-4xl font-semibold tracking-tight text-ink leading-tight">
          {post.title}
        </h1>
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
