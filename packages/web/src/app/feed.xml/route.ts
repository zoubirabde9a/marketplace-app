import type { NextRequest } from "next/server";
import { upscaleOuedknissForCrawler } from "@/lib/images";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");
const API_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.MARKETPLACE_API_URL ??
  "http://127.0.0.1:3100"
).replace(/\/$/, "");

// Atom 1.0 feed of the 50 most-recently-posted listings. Atom (vs RSS 2.0) is
// the stricter spec, validates with no warnings against the W3C feed validator,
// and is what Google's deprecated-but-still-honored Feedburner ecosystem and
// modern AI crawlers (ChatGPT, Perplexity, Claude search) all parse cleanly.
//
// Cached for 5 minutes via route-level revalidate so feed-pulling agents
// don't hammer the API.
export const revalidate = 300;

interface FeedHit {
  productId: string;
  title?: { value?: string } | null;
  brand?: string;
  heroImageUrl?: string | null;
  postedAt?: string | null;
  sellerDisplayName?: string | null;
  priceMinor?: string;
  priceFromMinor?: string;
  currency?: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Threshold for what counts as a "real" price. Ouedkniss sellers commonly use
// placeholder values (priceMinor=0 for "Prix sur demande", priceMinor=100 for
// "1 DA" as a price-omission convention) when the actual price is negotiable.
// Emitting "0.00 DZD" or "1.00 DZD" in feed summaries makes the catalog look
// broken to AI crawlers and RSS readers that summarise listings. 100 DZD
// (~$0.75) is well below any legitimate consumer-goods price on the platform.
// priceMinor is in santeem (1 DZD = 100 santeem), so 100 DZD = 10000 minor.
const MIN_REAL_PRICE_MINOR = 10000;

function fmtPrice(minor: string | undefined, currency: string | undefined): string | null {
  if (!minor || !currency) return null;
  const n = Number(minor);
  if (!Number.isFinite(n) || n < MIN_REAL_PRICE_MINOR) return null;
  const major = (n / 100).toFixed(2);
  return `${major} ${currency}`;
}

// Module-level harvest cache. Same pattern as sitemap.ts and CategoryFooter
// — Next 15's ISR was being defeated on these routes by cache:"no-store"
// inside (iter-16/iter-29 lessons), so each /feed.xml hit was reaching
// the API. 5-min TTL matches the route's revalidate; in-flight dedup
// prevents thundering herd at TTL expiry.
const FEED_TTL_MS = 5 * 60 * 1000;
let feedCache: { hits: FeedHit[]; ts: number } | null = null;
let feedInFlight: Promise<FeedHit[]> | null = null;

async function getFeedHits(): Promise<FeedHit[]> {
  const now = Date.now();
  if (feedCache && now - feedCache.ts < FEED_TTL_MS) return feedCache.hits;
  if (feedInFlight) return feedInFlight;
  feedInFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/v1/products?sort=newest&limit=50`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { data?: FeedHit[] };
      const hits = body.data ?? [];
      // Don't cache empty payloads — same iter-16/iter-29 lesson, refuse to
      // lock a transient API hiccup in for the full TTL.
      if (hits.length > 0) {
        feedCache = { hits, ts: Date.now() };
      }
      return hits;
    } catch (err) {
      console.error("[feed.xml] harvest failed:", err);
      return [];
    } finally {
      feedInFlight = null;
    }
  })();
  return feedInFlight;
}

export async function GET(req: NextRequest) {
  const hits = await getFeedHits();
  const updated =
    hits.length > 0 && hits[0].postedAt ? hits[0].postedAt : new Date().toISOString();
  // Last-Modified in RFC 7231 IMF-fixdate format (the only format the spec
  // permits). Lets RSS/Atom readers do conditional GET — they send
  // If-Modified-Since and we return 304 when the feed hasn't changed,
  // saving bandwidth and signalling freshness more reliably than the
  // 5-min cache-control window.
  const updatedDate = new Date(updated);
  const lastModified = Number.isFinite(updatedDate.getTime())
    ? updatedDate.toUTCString()
    : new Date().toUTCString();
  // ETag is a stricter freshness fingerprint than Last-Modified — it changes
  // any time either the newest postedAt OR the entry count moves, so a feed
  // reader using If-None-Match catches mutations Last-Modified would miss
  // (e.g. one product replaced by another with an older postedAt). Quoted
  // per RFC 7232; W/ prefix would make it weak — strict is fine here.
  const etag = `"feed-${hits.length}-${updatedDate.getTime()}"`;
  // 304 Not Modified path. Honour either conditional header — feed readers
  // typically send one or the other but not both. Per RFC 7232 strong-ETag
  // matches are exact-string comparison; If-Modified-Since is the
  // toUTCString round-trip we hand them.
  const ifNoneMatch = req.headers.get("if-none-match");
  const ifMod = req.headers.get("if-modified-since");
  if ((ifNoneMatch && ifNoneMatch === etag) || (ifMod && ifMod === lastModified)) {
    return new Response(null, {
      status: 304,
      headers: {
        etag,
        "last-modified": lastModified,
        "cache-control":
          "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
      },
    });
  }

  const entries = hits
    .filter((h) => h.productId && h.title?.value)
    .map((h) => {
      const url = `${SITE_URL}/product/${encodeURIComponent(h.productId)}`;
      const title = h.title!.value!;
      const posted = h.postedAt ?? new Date().toISOString();
      const price = fmtPrice(h.priceMinor ?? h.priceFromMinor, h.currency);
      const summaryParts = [
        h.brand ? `Marque : ${h.brand}` : null,
        h.sellerDisplayName ? `Vendeur : ${h.sellerDisplayName}` : null,
        price ? `Prix : ${price}` : null,
      ].filter(Boolean);
      const summary = summaryParts.length > 0 ? summaryParts.join(" · ") : title;
      return `  <entry>
    <title>${escapeXml(title)}</title>
    <link rel="alternate" type="text/html" href="${escapeXml(url)}"/>
    <id>${escapeXml(url)}</id>
    <updated>${escapeXml(posted)}</updated>
    <published>${escapeXml(posted)}</published>
    <author><name>${escapeXml(h.sellerDisplayName ?? "Teno Store")}</name></author>
    <summary>${escapeXml(summary)}</summary>${
        h.heroImageUrl
          ? `\n    <link rel="enclosure" type="image/jpeg" href="${escapeXml(upscaleOuedknissForCrawler(h.heroImageUrl))}"/>`
          : ""
      }
  </entry>`;
    })
    .join("\n");

  // xml:lang on the feed root — Atom-spec best practice. Most listing
  // content is French (DZD-priced Algerian inventory); declaring this
  // helps RSS readers and AI crawlers pick the right language model when
  // summarising entries.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="fr">
  <title>Teno Store — Recent listings</title>
  <subtitle>Les 50 annonces les plus récentes sur Teno Store — téléphones, informatique, électroménager, mode et véhicules de vendeurs algériens, prix en dinars (DZD).</subtitle>
  <link rel="alternate" type="text/html" href="${SITE_URL}/"/>
  <link rel="self" type="application/atom+xml" href="${SITE_URL}/feed.xml"/>
  <id>${SITE_URL}/feed.xml</id>
  <updated>${escapeXml(updated)}</updated>
  <author><name>Teno Store</name></author>
  <icon>${SITE_URL}/icon.svg</icon>
${entries}
</feed>
`;

  return new Response(xml, {
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      // Encourage CDN caching too — feed content changes at most every few
      // minutes (catalog seed loop pace), and feed readers/agents poll on
      // their own cadence (15min-1h typical).
      "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
      "last-modified": lastModified,
      etag,
    },
  });
}
