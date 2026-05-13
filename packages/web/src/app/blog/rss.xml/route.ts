// RSS 2.0 feed for /blog. Distinct from /feed.xml (which is the catalog
// Atom feed for recent products). AI crawlers (ChatGPT, Perplexity,
// Claude search, Bing Chat) and feed readers prefer RSS for editorial
// content; emitting both formats covers the discovery surface for AI
// search and traditional feed aggregators.

import { BLOG_POSTS } from "../posts";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

export const revalidate = 600;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc822(iso: string): string {
  // RSS 2.0 spec requires RFC 822 dates. Date.toUTCString() produces an
  // RFC 822-compliant format (the "GMT" suffix is the RFC's preferred zone
  // representation for UTC; feed validators accept this).
  return new Date(iso).toUTCString();
}

export function GET() {
  const lastBuildDate = BLOG_POSTS[0]
    ? toRfc822(BLOG_POSTS[0].dateModified)
    : new Date().toUTCString();

  const items = BLOG_POSTS.map((post) => {
    const url = `${SITE_URL}/blog/${post.slug}`;
    return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${escapeXml(post.description)}</description>
      <pubDate>${toRfc822(post.datePublished)}</pubDate>
      <category>${escapeXml(post.category)}</category>
      <enclosure url="${url}/opengraph-image" type="image/png"/>
    </item>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Blog Teno Store</title>
    <link>${SITE_URL}/blog</link>
    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Guides d'achat et conseils vendeurs pour le marketplace algérien Teno Store.</description>
    <language>fr-DZ</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <ttl>60</ttl>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}
