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
  // Source publication date (Ouedkniss original-post date for scraped
  // listings, else our DB createdAt). Used as the entry's <published>.
  postedAt?: string | null;
  // Our DB ingestion time (always product.createdAt — see iter-16 sitemap
  // fix). Used as the entry's <updated> so feed readers see a recent
  // last-modified signal even when the Ouedkniss source date is years
  // old. Falls back to postedAt when the API doesn't ship it (older
  // builds prior to iter-16).
  updatedAt?: string | null;
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

// Sanity ceiling on the high end: ~1B DZD = $7.5M USD. Algerian real-
// estate sometimes lists in centimes (1 DZD = 100 centimes) instead of
// dinars, which the scraper can't disambiguate at parse time. Above this
// ceiling the displayed price is almost certainly 100× the true value
// (e.g. a $10K parcel of land rendering as $1B). Suppress in the feed
// summary the same way we suppress below-floor placeholder prices.
const MAX_REAL_PRICE_MINOR = 100_000_000_000;

function fmtPrice(minor: string | undefined, currency: string | undefined): string | null {
  if (!minor || !currency) return null;
  const n = Number(minor);
  if (!Number.isFinite(n) || n < MIN_REAL_PRICE_MINOR) return null;
  if (n > MAX_REAL_PRICE_MINOR) return null;
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
      // sort=recently_added orders by our DB ingestion time (createdAt),
      // not by the seller's source post date. The latter (sort=newest) is
      // what buyers see on UI surfaces, but for an Atom feed "newly added
      // to our catalog" is the meaningful axis — a feed-reader that polls
      // every 5 min wants to know what we just ingested, not what
      // Ouedkniss sellers happened to post recently. Until this change
      // the feed's <updated> tag was lagging ~2 days behind ingestion
      // because the top-50 by-postedAt set was dominated by older
      // fixture-era rows with fresh DB updates but stale source dates.
      const res = await fetch(`${API_URL}/v1/products?sort=recently_added&limit=50`, {
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
  // Top-level feed <updated> = the MAX ingestion time across all entries
  // (Atom RFC 4287: "the most recent instant in time when an entry or feed
  // was modified in a way the publisher considers significant").
  //
  // Hits come back sorted by source postedAt (what buyers mean by "newest"
  // — see catalog/sort.ts), NOT by ingestion time. Using hits[0].updatedAt
  // therefore lags arbitrarily: a freshly-ingested listing whose seller
  // originally posted it weeks ago has a newer updatedAt than the current
  // hits[0]'s updatedAt, so the feed legitimately changed — but
  // hits[0].updatedAt didn't move and feed readers see the same Atom
  // <updated>, the same ETag, the same Last-Modified, and never re-pull.
  // Live probe 2026-05-12: the feed's <updated> was 14h stale even though
  // the catalog kept ingesting through that window. Taking max(updatedAt)
  // tracks ingestion correctly without changing what entries appear or how
  // they're ordered.
  let maxUpdated: number | null = null;
  let maxUpdatedIso: string | null = null;
  for (const h of hits) {
    const iso = h.updatedAt ?? h.postedAt ?? null;
    if (!iso) continue;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    if (maxUpdated === null || t > maxUpdated) {
      maxUpdated = t;
      maxUpdatedIso = iso;
    }
  }
  const updated = maxUpdatedIso ?? new Date().toISOString();
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
          "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600",
      },
    });
  }

  const entries = hits
    .filter((h) => h.productId && h.title?.value)
    .map((h) => {
      const url = `${SITE_URL}/product/${encodeURIComponent(h.productId)}`;
      const title = h.title!.value!;
      // <published> uses the source's perspective (Ouedkniss original post
      // date or our createdAt fallback). <updated> uses our ingestion time
      // so feed readers' "last modified" UI accurately reflects when the
      // entry appeared in OUR feed, not when the source originally posted.
      // Pre-iter-16 API builds didn't ship updatedAt — fall back to posted.
      const posted = h.postedAt ?? new Date().toISOString();
      const lastUpdated = h.updatedAt ?? posted;
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
    <updated>${escapeXml(lastUpdated)}</updated>
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
  <title>Teno Store — Annonces récentes</title>
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
      "cache-control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600",
      "last-modified": lastModified,
      etag,
    },
  });
}
