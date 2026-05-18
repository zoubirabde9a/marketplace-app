import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, type SearchHit } from "@/lib/api";
import { searchProductsCached } from "@/lib/searchCache";
import { cleanProductTitle, formatPrice, formatPriceRange, formatRelativeTime } from "@/lib/format";
import { Gallery } from "@/components/Gallery";
import { CounterfeitBadge } from "@/components/CounterfeitBadge";
import { ShareButton } from "@/components/ShareButton";
import { AddToCart } from "@/components/AddToCart";
import { ProductGrid } from "@/components/ProductGrid";
import { jsonLdString } from "@/lib/jsonld";
import { upscaleOuedknissForCrawler } from "@/lib/images";
import { humanizeCategorySlug } from "@/lib/categories";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

// Ouedkniss sellers commonly use placeholder prices: priceMinor=0 ("Prix sur
// demande"), priceMinor=100 ("1 DA"), priceMinor=400 ("4 DA") — all
// negotiate-only conventions, not real prices. Emitting them in meta
// descriptions, og:price, JSON-LD Offers, and shopping aggregator payloads
// makes the catalog look broken or fraudulent. 100 DZD (=10000 santeem,
// ~$0.75) is well below the cheapest legitimate consumer-goods listing on
// the platform; anything under this threshold is treated as "Prix sur demande".
// Match feed.xml's MIN_REAL_PRICE_MINOR.
const MIN_REAL_PRICE_MINOR = 10000;
// Sanity ceiling: ~1B DZD ($7.5M USD). Above this the price is almost
// certainly off by a 100× factor — Algerian real estate sometimes lists in
// centimes (1 DZD = 100 centimes) instead of dinars, and the scraper
// can't disambiguate at parse time. 5 immobilier rows currently sit at
// values like "13.75 TRILLION santeem" (= $1B USD for a parcel of land).
// Match feed.xml's MAX_REAL_PRICE_MINOR.
const MAX_REAL_PRICE_MINOR = 100_000_000_000;

// Min length for the seller-provided description before we trust it as a
// SERP/JSON-LD/social preview. Below this, fall back to the structured
// French description built from validated catalog fields.
const MIN_USEFUL_DESC_CHARS = 40;

// Algerian sellers commonly prepend a single Arabic boilerplate line
// ("التوصيل متوفر لجميع الولايات" — "Delivery available to all wilayas")
// to descriptions that continue in French. The site declares
// <html lang="fr"> and tags Product.inLanguage="fr"; shipping Arabic-
// leading text in <meta description> + JSON-LD on a French-locale page
// sends Google a mixed-language signal that hurts both SERP snippet
// quality and ranking for French queries. ~31% of long-description
// products on prod start with an Arabic-script run. Strip leading
// sentence-ish chunks that are predominantly Arabic; stop at the first
// chunk that's predominantly Latin so we keep useful Arabic content
// when the seller wrote the *whole* description in Arabic (those pages
// should keep their Arabic copy; Google can decide what to do with the
// French-tagged shell).
// Strip a leading run of Arabic-script characters (plus interleaved
// whitespace, punctuation, digits, emoji) up to the first Latin letter.
// Boilerplate Arabic lines often run straight into French without a
// sentence terminator ("التوصيل متوفر لجميع الولايات Compatible avec…"),
// so chunk-splitting on punctuation isn't enough; we need a within-chunk
// strip. If the string has no Latin letters at all (description is fully
// Arabic), leave it alone — those sellers wrote a complete Arabic
// description and stripping it would force the template fallback.
function stripLeadingArabic(s: string): string {
  if (!/[A-Za-zÀ-ÿ]/.test(s)) return s;
  // Character class: Arabic + Arabic-Supplement + Arabic-Extended-A +
  // Arabic Presentation Forms-A/B, plus whitespace, Unicode P/S, digits.
  // Stops at the first character outside that union — in practice, the
  // first Latin letter.
  const stripped = s.replace(
    /^[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿\s\p{P}\p{S}\d]+/u,
    "",
  ).trim();
  // Defensive: if the strip somehow ate the entire string (shouldn't, given
  // the Latin-letter guard above), return the original.
  return stripped.length > 0 ? stripped : s;
}

// Ouedkniss masks seller-provided phone numbers and email addresses in
// public listing bodies before serving them, replacing the actual contact
// string with empty space while leaving the surrounding "📞" / "📧" emoji
// and any seller-typed separators (slashes, dashes) intact. The artifact
// reads as broken text on a product page ("📞 /" with nothing after it,
// "📧" on its own line), and Google sometimes pulls the empty line into
// the SERP snippet. Strip lines whose visible content is just a contact
// emoji plus separators/whitespace, and collapse runs of 3+ blank lines
// to a single blank line so the cleanup doesn't leave gaping holes.
function stripMaskedContactLines(s: string): string {
  if (!s) return s;
  const cleaned = s
    .split(/\r?\n/)
    .filter((line) => !/^\s*[📞📧☎]\s*[\s/\\\-:|—–]*\s*$/u.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned;
}

// Shared description builder — used both by generateMetadata (SERP +
// social preview) and the page body's Product JSON-LD `description`
// field. Without this, the JSON-LD payload was shipping the raw 4-word
// Arabic seller body ("سيارة ماشاء الله") on a Volkswagen T-Roc page;
// Google product rich-cards parse JSON-LD `description` directly.
function buildProductDescription(args: {
  fullTitle: string;
  cleanedDesc: string;
  brand: string | null | undefined;
  sellerDisplayName: string | null | undefined;
  variants: ReadonlyArray<{ priceMinor?: string; currency?: string }>;
  // Humanized French category label (e.g. "Téléphones", "Automobiles & Véhicules").
  // Threaded through so thin-content fallback descriptions get a category
  // segment — ~26% of products land in the fallback path (seller description
  // < MIN_USEFUL_DESC_CHARS), and without category the template differs only
  // by title between same-brand listings. Injecting one of ~30 French
  // category labels adds unique scrapable text + dilutes the boilerplate
  // ratio for Google's near-duplicate detection.
  categoryLabel: string | null | undefined;
}): string {
  if (args.cleanedDesc && args.cleanedDesc.length >= MIN_USEFUL_DESC_CHARS) {
    return args.cleanedDesc;
  }
  const parts: string[] = [args.fullTitle];
  if (args.categoryLabel) parts.push(args.categoryLabel);
  if (args.brand) parts.push(`marque ${args.brand}`);
  if (args.sellerDisplayName) parts.push(`de ${args.sellerDisplayName}`);
  const lowest = [...args.variants].sort(
    (a, b) => Number(a.priceMinor) - Number(b.priceMinor),
  )[0];
  if (lowest) {
    const n = Number(lowest.priceMinor);
    if (Number.isFinite(n) && n >= MIN_REAL_PRICE_MINOR && n <= MAX_REAL_PRICE_MINOR) {
      parts.push(`${(n / 100).toLocaleString("fr-DZ")} ${lowest.currency}`);
    } else {
      parts.push("Prix sur demande");
    }
  }
  return `${parts.join(" · ")} — annonce sur Teno Store, marketplace algérien.`;
}

interface Params { id: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const p = await getProduct(id).catch(() => null);
  if (!p) notFound();
  // Visible UI (H1, breadcrumb, gallery alt) gets the de-duplicated title;
  // SEO surfaces (JSON-LD name, OG, <title>) keep the raw `fullTitle` so we
  // don't quietly diverge from what Google has indexed.
  const fullTitle = p.title.value;
  const displayTitle = cleanProductTitle(fullTitle);
  // Sellers routinely paste 100+ char titles full of spec strings:
  // "SAMSUNG GALAXY TAB A11 4G LTE - 4GB - 64GB - 8.7" LED WXGA - WI-FI - BLUETOOTH - 8 MPXL - 5100MAH - GRIS SM-X135G"
  // Google truncates SERP titles at ~55-65 chars; everything past the
  // truncation point is wasted. Trim for <title> only — the visible H1
  // and JSON-LD `name` still carry the full string for users / structured
  // data. Break at the last space before the limit so we don't leave a
  // dangling word, then append an ellipsis if we actually trimmed.
  const TITLE_BUDGET = 60;
  const title = (() => {
    const t = fullTitle.trim();
    if (t.length <= TITLE_BUDGET) return t;
    const cut = t.slice(0, TITLE_BUDGET);
    const space = cut.lastIndexOf(" ");
    return (space > 30 ? cut.slice(0, space) : cut).replace(/[\s\p{P}\p{S}]+$/u, "") + "…";
  })();
  // Meta descriptions render as a single line in search/social previews, so
  // collapse whitespace and trim leading decorative symbols (✅, ✔️, ⭐, …)
  // that scraped seller copy tends to lead with — those break the snippet.
  // Cap at 155: Google SERP truncates ~155-160; the previous 200 cap was
  // landing mid-sentence cuts on most products. Break at the last word
  // boundary so we don't slice through a word; append "…" if we trimmed.
  const DESC_BUDGET = 155;
  const cleanedDesc = (() => {
    const raw = (p.description?.value ? stripMaskedContactLines(p.description.value) : p.description?.value)
      ?.replace(/\s+/g, " ")
      .replace(/^[\s\p{P}\p{S}]+/u, "")
      .trim();
    if (!raw) return raw;
    const stripped = stripLeadingArabic(raw).replace(/^[\s\p{P}\p{S}]+/u, "").trim();
    // If stripping left us with too little to be a useful SERP snippet,
    // restore the raw text — better a mixed-language snippet than an empty
    // one, and the template fallback in buildProductDescription is also
    // available downstream if cleanedDesc is shorter than MIN_USEFUL_DESC_CHARS.
    const base = stripped.length >= MIN_USEFUL_DESC_CHARS ? stripped : raw;
    if (base.length <= DESC_BUDGET) return base;
    const cut = base.slice(0, DESC_BUDGET);
    const space = cut.lastIndexOf(" ");
    return (space > 80 ? cut.slice(0, space) : cut).replace(/[\s\p{P}\p{S}]+$/u, "") + "…";
  })();
  // Shared structured-description helper (module scope) — also consumed by
  // ProductPage for the JSON-LD `description` field, so Google's product
  // rich-card snippet doesn't ship the raw Arabic seller blurb either.
  const primaryCategoryLabel = p.categoryIds[0]
    ? humanizeCategorySlug(p.categoryIds[0])
    : null;
  const desc = buildProductDescription({
    fullTitle,
    cleanedDesc: cleanedDesc ?? "",
    brand: p.brand,
    sellerDisplayName: p.sellerDisplayName,
    variants: p.variants,
    categoryLabel: primaryCategoryLabel,
  });
  // Resolve full hero metadata (width/height/alt) so social previews can size
  // the image without a round-trip and avoid Facebook "image too small" warnings.
  const heroImage = p.heroImageUrl
    ? p.images.find((img) => img.url === p.heroImageUrl) ?? null
    : null;
  // Ouedkniss CDN hero URLs come back at /400/ size — below Facebook /
  // LinkedIn / Twitter summary_large_image minimums (1200x630). Swap the
  // size segment for share-card metadata only; the visible <img> on the
  // page can stay at the cheaper /400/ asset. Shared helper.
  const shareImageUrl = p.heroImageUrl
    ? upscaleOuedknissForCrawler(p.heroImageUrl)
    : undefined;
  // If we successfully upscaled (URL changed), omit explicit width/height —
  // they describe the /400/ asset, and Facebook/Twitter will re-detect.
  // If pattern didn't match (URL stayed the same), keep the original
  // width/height metadata.
  const upscaled = shareImageUrl && shareImageUrl !== p.heroImageUrl;
  // Compute the dimensions of the UPSCALED share image. Ouedkniss CDN URLs
  // encode longest-edge size in the path segment ("/1200/medias/..."), and
  // upscaleOuedknissForCrawler() rewrites to /1200/. With the original
  // width+height from the DB, we can compute the upscaled dims exactly:
  // factor = 1200 / max(origW, origH); upscaledW/H = round(origW/H * factor).
  // Without this, the upscaled branch shipped no og:image:width/height, so
  // social/AI link-preview renderers (Bing Chat, Slack, Discord, LinkedIn,
  // Pinterest) had to fetch the image to detect dimensions before laying
  // out the preview card — slower first-paint of the card, occasional
  // timeout fallback to a no-image preview. Visible to the user as
  // "tiny inline preview" instead of the full-bleed product hero.
  let shareImageW: number | undefined;
  let shareImageH: number | undefined;
  if (heroImage?.width && heroImage?.height) {
    if (!upscaled) {
      shareImageW = heroImage.width;
      shareImageH = heroImage.height;
    } else {
      const factor = 1200 / Math.max(heroImage.width, heroImage.height);
      shareImageW = Math.round(heroImage.width * factor);
      shareImageH = Math.round(heroImage.height * factor);
    }
  } else if (upscaled) {
    // DB record is missing dimensions (common — image-metadata harvest is
    // best-effort during scrape). For upscaled Ouedkniss URLs we still
    // know the longest edge is exactly 1200 (it's literally what the
    // upscale function produces — see lib/images.ts:18). Declaring
    // width=1200 + height=1200 is a safe over-estimate that lets the
    // renderer reserve the right amount of space; Facebook/Twitter
    // will re-fetch and correct to actual aspect ratio after first
    // render. Strictly better than emitting no dimensions at all,
    // which is what shipped before this commit.
    shareImageW = 1200;
    shareImageH = 1200;
  }
  const images = shareImageUrl
    ? [
        {
          url: shareImageUrl,
          // image/jpeg is correct for every URL on the Ouedkniss CDN
          // (their pipeline serves only JPEGs regardless of upstream
          // format). Declaring the type lets the renderer pre-allocate
          // the correct decoder pipeline.
          type: "image/jpeg",
          ...(shareImageW ? { width: shareImageW } : {}),
          ...(shareImageH ? { height: shareImageH } : {}),
          ...(heroImage?.altText ? { alt: heroImage.altText } : { alt: fullTitle }),
        },
      ]
    : undefined;
  const canonical = `/product/${encodeURIComponent(p.productId)}`;
  // Currency-based locale heuristic: DZD-priced listings come from Algerian
  // sellers whose titles/descriptions are predominantly French. Until the
  // API ships an explicit per-listing language tag, this is the best signal
  // available for og:locale (used by Facebook, LinkedIn, and indexers that
  // honor it). Defaults to en_US (matches the layout) for everything else.
  const productCurrency = p.variants[0]?.currency;
  const ogLocale = productCurrency === "DZD" ? "fr_DZ" : "en_US";
  // Open Graph product extension (og.me/Facebook product object): adds
  // og:type=product, product:price:amount/currency, product:availability,
  // and product:brand. Pinterest, Discord, Slack and Facebook product
  // cards parse these for proper price/stock rendering. Next.js Metadata's
  // typed openGraph doesn't support type:'product', so emit them via
  // `other` — which detects og:/product: prefixes and renders as
  // <meta property="..." />, matching the OG spec.
  const minorVariant = [...p.variants].sort(
    (a, b) => Number(a.priceMinor) - Number(b.priceMinor),
  )[0];
  // Only emit a price when we actually have one. priceMinor=0 (Ouedkniss
  // "Prix sur demande") would broadcast "0.00 DZD" to Facebook/Pinterest
  // product cards and tell shopping aggregators the item is free.
  const minorPriceNum = minorVariant ? Number(minorVariant.priceMinor) : NaN;
  const ogPriceAmount = Number.isFinite(minorPriceNum) && minorPriceNum >= MIN_REAL_PRICE_MINOR && minorPriceNum <= MAX_REAL_PRICE_MINOR
    ? (minorPriceNum / 100).toFixed(2)
    : undefined;
  // NOTE: og:type, product:* OG-extension tags are NOT emitted here. Next.js's
  // metadata.other field always renders <meta name="..."> but the Open Graph
  // spec (and Facebook's parser) requires <meta property="og:type"...> with
  // the `property` attribute — Facebook silently ignores `name=`. So these
  // tags are rendered inline in the page body's JSX below; React 19 hoists
  // <meta> from anywhere into <head>.
  return {
    // Bypass the layout's "%s · Teno Store" template — that suffix eats 13
    // chars and Google's SERP truncates at 55-65, so any product title >50
    // chars (common for our scraped Algerian listings — full spec strings
    // like "SoundPEATS C30 - ANC -52dB / Hi-Res Audio / 52H Batterie")
    // would lose its tail. Brand visibility is already covered by the URL,
    // breadcrumb, JSON-LD seller field, and OG site_name.
    title: { absolute: title },
    description: desc,
    alternates: {
      canonical,
      // Re-declare hreflang — Next.js replaces layout-level alternates
      // wholesale on child pages, dropping the fr-DZ / x-default signal
      // unless restored here.
      languages: {
        "fr-DZ": `${SITE_URL}${canonical}`,
        "ar-DZ": `${SITE_URL}${canonical}`,
        "x-default": `${SITE_URL}${canonical}`,
      },
      // Tell AI search crawlers + agent-discovery tools that the same product
      // content is available as JSON via REST. The MCP / A2A surfaces are
      // declared globally in /.well-known/agents.json; this is the per-page
      // hook that lets a crawler map an individual /product URL to its
      // /v1/products/<id> JSON twin without parsing any of those files.
      types: {
        "application/json": `https://api.teno-store.com/v1/products/${encodeURIComponent(p.productId)}`,
      },
    },
    openGraph: {
      // Use the full title here — Facebook / X / Discord cards have a
      // 88-char title slot, much more generous than Google SERP, so trimming
      // for OG would lose detail unnecessarily.
      title: fullTitle,
      description: desc,
      // siteName redeclared because Next.js metadata REPLACES openGraph
      // wholesale on child pages — no shallow-merge of nested fields.
      // Without this, FB / LinkedIn / Discord share previews on individual
      // product pages dropped the 'Teno Store' brand context entirely.
      siteName: "Teno Store",
      // When there's a seller hero image, surface it. When there isn't,
      // OMIT the field entirely so Next.js's file-based opengraph-image.tsx
      // convention can fill it in. Setting `images: undefined` explicitly
      // suppresses the convention.
      ...(images ? { images } : {}),
      url: canonical,
      locale: ogLocale,
      // Algerian listings also surface to Arabic-script and English-language
      // queries (titles often mix scripts; abbreviations like "iphone" hit
      // Arabic-keyed users too). Tell scrapers the same URL covers all three
      // — they can pick the right preview line for the audience.
      ...(ogLocale === "fr_DZ"
        ? { alternateLocale: ["ar_DZ", "en_US"] }
        : { alternateLocale: ["fr_DZ", "ar_DZ"] }),
    },
    twitter: {
      // Always summary_large_image — either the hero or the dynamic card
      // fills the slot. Omit twitter.images when no hero so the file-based
      // convention (which generates twitter:image alongside og:image) applies.
      card: "summary_large_image",
      // X allows ~70-char titles in summary_large_image; full title is fine.
      title: fullTitle,
      description: desc,
      ...(shareImageUrl ? { images: [shareImageUrl] } : {}),
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  // getProduct throws an ApiError on any non-2xx, including 404. Without
  // this catch the 404 propagates to error.tsx → HTTP 200 in the response,
  // and Google flags those as soft-404s. Catch any 404 specifically and
  // route through notFound() so Next emits a real 404 status; rethrow
  // anything else (5xx, network) so the error boundary still surfaces
  // genuine outages.
  const p = await getProduct(id).catch((err: unknown) => {
    const status = (err as { status?: number } | null)?.status;
    if (status === 404) return null;
    throw err;
  });
  if (!p) notFound();
  // Visible UI uses the de-duplicated title; SEO surfaces (JSON-LD `name`,
  // OG image, breadcrumb structured data) keep `p.title.value` so we don't
  // diverge from what Google has indexed.
  const displayTitle = cleanProductTitle(p.title.value);

  // Pull a small grid of related listings from the same seller for crawl-path
  // density and human discovery. With ~5,000 products and Googlebot's crawl
  // Related products fetched in a streaming Suspense child (see
  // RelatedProducts below). Previously this fetch ran inline here and
  // blocked the shell flush — putting the H1 ~110KB downstream of
  // CategoryFooter chips in the byte stream. Now the page's main info
  // (H1, gallery, description, seller contact) renders in the shell as
  // soon as getProduct resolves; related products stream in afterwards.

  const variants = [...p.variants].sort((a, b) => Number(a.priceMinor) - Number(b.priceMinor));
  const inStockVariants = variants.filter((v) => v.inStock);
  const minPrice = variants[0]?.priceMinor;
  const maxPrice = variants[variants.length - 1]?.priceMinor;
  const currency = variants[0]?.currency ?? "USD";
  // Suppress placeholder prices in the visible price label too — Ouedkniss
  // sellers commonly post `priceMinor = 100` (= 1 DZD) or `0` as a
  // negotiate-only convention. The SERP description and JSON-LD Offers
  // already swap those for "Prix sur demande" / drop the Offer; the visible
  // H1-area was still rendering "DZD 1", which made the listing look like
  // an obvious mis-price to buyers. Match the existing `MIN_REAL_PRICE_MINOR`
  // threshold so the three surfaces stay consistent.
  //
  // Ceiling MAX_REAL_PRICE_MINOR is defined at module scope above.
  const minPriceNum = Number(minPrice ?? "0");
  const maxPriceNum = Number(maxPrice ?? "0");
  const allBelowFloor =
    Number.isFinite(minPriceNum) && Number.isFinite(maxPriceNum) && maxPriceNum < MIN_REAL_PRICE_MINOR;
  const anyAboveCeiling =
    Number.isFinite(maxPriceNum) && maxPriceNum > MAX_REAL_PRICE_MINOR;
  const priceLabel = allBelowFloor || anyAboveCeiling
    ? "Prix sur demande"
    : variants.length > 1
      ? formatPriceRange(minPrice ?? null, maxPrice ?? null, currency)
      : formatPrice(minPrice ?? null, currency);

  // Build schema.org/Product JSON-LD so search engines and AI agents can
  // unambiguously parse this listing without scraping markup.
  const minorToMajor = (minor: string | undefined) => {
    if (!minor) return undefined;
    const n = Number(minor);
    if (!Number.isFinite(n)) return undefined;
    return (n / 100).toFixed(2);
  };
  const anyInStock = inStockVariants.length > 0;
  // Google Merchant requires priceValidUntil; we don't have a real expiry, so
  // emit one year from now (refreshes on every render since the page is dynamic).
  const priceValidUntil = (() => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.toISOString().slice(0, 10);
  })();
  // Intentionally NOT emitting itemCondition. The scraped Ouedkniss
  // inventory is a mix of new, used, and refurbished and the API doesn't
  // expose per-listing condition data — uniformly declaring
  // NewCondition (the previous default) misrepresents the catalog and
  // can trip Google's product-data-quality / SEO-spam heuristics.
  // Omitting the field lets Google's own heuristics infer rather than
  // ingesting a wrong fact. Add this back per-listing if/when the API
  // grows a `condition` field.
  //
  // Geo-targeting for the Offer. Built from p.shipsTo (the source of truth
  // — for Ouedkniss-scraped products this is ["DZ"]; the API populates it
  // per-listing). Without an explicit `areaServed`, Google has to infer the
  // offer's region from the page's locale + JSON-LD inLanguage; that works
  // OK for unambiguous queries but degrades when the buyer's IP is outside
  // the country (a French buyer searching "Renault Symbol Algérie" gets
  // a less-confident regional match). Country names use ISO 3166-1 alpha-2
  // — same form schema.org's Country examples use and the form Google's
  // structured-data validator expects.
  const offerAreaServed = p.shipsTo && p.shipsTo.length > 0
    ? p.shipsTo.length === 1
      ? { "@type": "Country", name: p.shipsTo[0] }
      : p.shipsTo.map((cc) => ({ "@type": "Country", name: cc }))
    : undefined;
  // Skip the Offer/AggregateOffer block entirely when no variant has a real
  // price. Emitting Offer with price="0.00" misrepresents Ouedkniss "Prix sur
  // demande" listings as free items in Google rich results, Pinterest cards,
  // and shopping aggregators. Without an Offer, the Product node still ranks
  // for the rich-result eligibility on the Product type (name, image, brand,
  // description) — just without a price line in the snippet.
  const hasRealPrice = variants.some((v) => {
    const n = Number(v.priceMinor);
    return Number.isFinite(n) && n >= MIN_REAL_PRICE_MINOR && n <= MAX_REAL_PRICE_MINOR;
  });
  const offers = !hasRealPrice
    ? undefined
    : variants.length === 1
      ? {
          "@type": "Offer",
          price: minorToMajor(variants[0].priceMinor),
          priceCurrency: variants[0].currency,
          availability: variants[0].inStock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          priceValidUntil,
          ...(offerAreaServed ? { areaServed: offerAreaServed } : {}),
          ...(variants[0].sku ? { sku: variants[0].sku } : {}),
          url: `${SITE_URL}/product/${encodeURIComponent(p.productId)}`,
          ...(p.sellerId && p.sellerDisplayName
            ? {
                seller: {
                  // @type Store matches the canonical Store node on
                  // /store/<uuid> (iter-62). @id reference connects the
                  // two pages' entity graphs — KG bots resolve @id
                  // cross-page so the Offer.seller and the storefront
                  // Store are seen as the same entity, not two
                  // independent organisations with the same name.
                  "@type": "Store",
                  "@id": `${SITE_URL}/store/${encodeURIComponent(p.sellerId)}`,
                  name: p.sellerDisplayName,
                  identifier: p.sellerId,
                  url: `${SITE_URL}/store/${encodeURIComponent(p.sellerId)}`,
                },
              }
            : {}),
        }
      : variants.length > 1
      ? {
          "@type": "AggregateOffer",
          offerCount: variants.length,
          lowPrice: minorToMajor(minPrice),
          highPrice: minorToMajor(maxPrice),
          priceCurrency: currency,
          availability: anyInStock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          priceValidUntil,
          ...(offerAreaServed ? { areaServed: offerAreaServed } : {}),
          url: `${SITE_URL}/product/${encodeURIComponent(p.productId)}`,
          ...(p.sellerId && p.sellerDisplayName
            ? {
                seller: {
                  // @type Store matches the canonical Store node on
                  // /store/<uuid> (iter-62). @id reference connects the
                  // two pages' entity graphs — KG bots resolve @id
                  // cross-page so the Offer.seller and the storefront
                  // Store are seen as the same entity, not two
                  // independent organisations with the same name.
                  "@type": "Store",
                  "@id": `${SITE_URL}/store/${encodeURIComponent(p.sellerId)}`,
                  name: p.sellerDisplayName,
                  identifier: p.sellerId,
                  url: `${SITE_URL}/store/${encodeURIComponent(p.sellerId)}`,
                },
              }
            : {}),
        }
      : undefined;

  const productJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${SITE_URL}/product/${encodeURIComponent(p.productId)}`,
    name: p.title.value,
    productID: p.productId,
    url: `${SITE_URL}/product/${encodeURIComponent(p.productId)}`,
    // isPartOf links every product to the canonical Teno Store Organization
    // node on the home page. Without this, ~48k product pages look like
    // orphan entities to KG bots and AI panels — Brand is cross-linked,
    // Seller is cross-linked when present (Offer.seller above), but
    // marketplace tenancy was unstated. iter-63 fix.
    isPartOf: { "@id": `${SITE_URL}/#organization` },
    // Cross-link to the canonical /product/<id> WebPage that hosts this
    // Product entity. Same `@id` resolves both nodes.
    mainEntityOfPage: { "@id": `${SITE_URL}/product/${encodeURIComponent(p.productId)}#webpage` },
  };
  // JSON-LD description feeds Google product rich-cards. Use the same
  // structured fallback we built for <meta description> when the seller
  // body is too short / unhelpful (e.g. a 4-word Arabic blurb on a major
  // listing). Compute via the shared buildProductDescription helper so
  // SERP meta + JSON-LD stay aligned.
  const ldRaw = (p.description?.value ? stripMaskedContactLines(p.description.value) : "")
    .replace(/^[\s\p{P}\p{S}]+/u, "")
    .trim();
  // Mirror the strip applied to <meta description>: drop leading Arabic-
  // boilerplate chunks so the JSON-LD Product.description that Google
  // ingests for product rich-cards stays language-consistent with the
  // French-tagged page shell. See stripLeadingArabic docstring for the why.
  const ldStripped = stripLeadingArabic(ldRaw).replace(/^[\s\p{P}\p{S}]+/u, "").trim();
  const ldCleanedDesc = ldStripped.length >= MIN_USEFUL_DESC_CHARS ? ldStripped : ldRaw;
  productJsonLd.description = buildProductDescription({
    fullTitle: p.title.value,
    cleanedDesc: ldCleanedDesc,
    brand: p.brand,
    sellerDisplayName: p.sellerDisplayName,
    variants: p.variants,
    categoryLabel: p.categoryIds[0] ? humanizeCategorySlug(p.categoryIds[0]) : null,
  });
  if (p.images && p.images.length > 0) {
    // Deduplicate by URL — the API often returns the hero as both
    // p.heroImageUrl AND the first entry in p.images, so the gallery
    // array starts with a duplicate of the hero. JSON-LD readers
    // (Google's parser, AI agents) shouldn't see the same URL twice.
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const img of p.images) {
      const u = upscaleOuedknissForCrawler(img.url);
      if (!seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
    }
    if (urls.length > 0) productJsonLd.image = urls;
  } else if (p.heroImageUrl) {
    productJsonLd.image = [upscaleOuedknissForCrawler(p.heroImageUrl)];
  }
  if (p.brand) {
    // @id + url make the Brand a stable entity Google can dedupe across all
    // listings on this site. Without @id, every product page declares an
    // anonymous Brand node — Google has to guess "Renault on Teno Store"
    // is the same entity across 200+ Renault listings. With @id pointing
    // at the canonical brand-slice URL (the same target the visible brand
    // chip links to since iter-10), all those listings cluster under one
    // Brand entity in Google's knowledge graph, and the brand-slice page
    // accumulates the entity's authority. Pure additive change — strings
    // and ImageObject brand shapes both still validate as Product.brand,
    // and Google's structured-data validator accepts ${SITE_URL}/search?brand=X
    // as the entity URL.
    const brandSliceUrl = `${SITE_URL}/search?brand=${encodeURIComponent(p.brand)}`;
    productJsonLd.brand = {
      "@type": "Brand",
      "@id": brandSliceUrl,
      name: p.brand,
      url: brandSliceUrl,
    };
  }
  // Surface the primary category to schema.org's `category` field so Google
  // can place us in its product taxonomy (e.g. browse-card grouping).
  // categoryIds are slug-style ("telephones", "informatique") — humanise the
  // first segment for the JSON-LD payload.
  if (p.categoryIds.length > 0 && p.categoryIds[0]) {
    // Use the same FR_CATEGORY map as search slice H1/title so Google's
    // product taxonomy gets the proper French label ('Automobiles &
    // Véhicules') instead of an ASCII slug-with-dashes-replaced string
    // ('automobiles vehicules').
    productJsonLd.category = humanizeCategorySlug(p.categoryIds[0]);
  }
  // Promote a variant SKU to the Product level so Google can match this
  // listing to known catalogs even without scanning the Offer. For
  // multi-variant products we use the cheapest variant's SKU (same one
  // surfaced in the Offer/AggregateOffer "from" price) — schema.org
  // accepts a single representative SKU at Product level even when
  // variants exist, and Google Shopping rich-cards prefer having one.
  const representativeSku = variants[0]?.sku;
  if (representativeSku) {
    productJsonLd.sku = representativeSku;
  }
  if (offers) productJsonLd.offers = offers;

  // ProductDetail doesn't carry aggregate rating today; if the API starts
  // returning one (e.g. p.rating / p.ratingCount), it can be plugged in here.
  const maybeRating = (p as unknown as { rating?: number; ratingCount?: number });
  if (
    typeof maybeRating.rating === "number" &&
    typeof maybeRating.ratingCount === "number" &&
    maybeRating.ratingCount > 0
  ) {
    productJsonLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: maybeRating.rating,
      reviewCount: maybeRating.ratingCount,
    };
  }

  // Breadcrumb hierarchy: Accueil → Catalogue → [Category] → Product
  // Adding the category step (when known) gives Google's mobile-SERP
  // breadcrumb display an extra French token to render and routes
  // PageRank from product pages into the category-slice landing
  // (/search?category=…). The slice landings already canonical-self
  // and are sitemapped (priority 0.7), so this is pure internal-link
  // flow, not a new indexable surface. Falls back to the 3-level form
  // when categoryIds is empty (a few legacy products) so existing
  // structured-data validators don't regress.
  const breadcrumbCategorySlug = p.categoryIds[0];
  const breadcrumbCategoryLabel = breadcrumbCategorySlug
    ? humanizeCategorySlug(breadcrumbCategorySlug)
    : null;
  const breadcrumbItems: Array<Record<string, unknown>> = [
    { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE_URL}/` },
    { "@type": "ListItem", position: 2, name: "Catalogue", item: `${SITE_URL}/search` },
  ];
  if (breadcrumbCategorySlug && breadcrumbCategoryLabel) {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 3,
      name: breadcrumbCategoryLabel,
      item: `${SITE_URL}/c/${encodeURIComponent(breadcrumbCategorySlug)}`,
    });
  }
  breadcrumbItems.push({
    "@type": "ListItem",
    position: breadcrumbItems.length + 1,
    name: p.title.value,
    item: `${SITE_URL}/product/${encodeURIComponent(p.productId)}`,
  });
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbItems,
  };

  // Tag the article subtree with the content language so screen readers
  // pronounce French titles correctly even though <html lang="en"> at the
  // root. Currency-based heuristic mirrors the og:locale logic above.
  const contentLang = currency === "DZD" ? "fr" : undefined;
  // Also tag in the JSON-LD so search/AI agents have the same signal.
  if (contentLang) productJsonLd.inLanguage = contentLang;

  // Open Graph product-extension tags. Rendered inline rather than via
  // metadata.other because the OG spec requires <meta property="og:type"...>
  // and Next's `other` map always emits `name=` which Facebook silently
  // ignores. React 19 auto-hoists <meta> from anywhere into <head>.
  const ogBodyMinor = (() => {
    const v = variants.find((x) => Number.isFinite(Number(x.priceMinor)) && Number(x.priceMinor) >= MIN_REAL_PRICE_MINOR);
    return v ? (Number(v.priceMinor) / 100).toFixed(2) : null;
  })();
  const ogBodyCurrency = ogBodyMinor ? variants[0]?.currency : null;
  const anyBodyInStock = variants.some((v) => v.inStock);

  return (
    <div className="pt-4 sm:pt-8" lang={contentLang}>
      <meta property="og:type" content="product" />
      <meta property="product:availability" content={anyBodyInStock ? "instock" : "oos"} />
      {ogBodyMinor && ogBodyCurrency && (
        <>
          <meta property="product:price:amount" content={ogBodyMinor} />
          <meta property="product:price:currency" content={ogBodyCurrency} />
          <meta property="og:price:amount" content={ogBodyMinor} />
          <meta property="og:price:currency" content={ogBodyCurrency} />
        </>
      )}
      {p.brand && <meta property="product:brand" content={p.brand} />}
      {p.categoryIds[0] && (
        // Use the humanized French category label so Facebook / Pinterest /
        // Discord product cards display "Téléphones" or "Électronique &
        // Électroménager" instead of the raw slug "telephones" /
        // "electronique electromenager". Same FR_CATEGORY map already
        // feeds JSON-LD Product.category, the breadcrumb category step,
        // and the buildProductDescription fallback — single source of
        // truth for the French taxonomy label.
        <meta property="product:category" content={humanizeCategorySlug(p.categoryIds[0])} />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd) }}
      />
      <Breadcrumbs
        title={displayTitle}
        categorySlug={breadcrumbCategorySlug ?? null}
        categoryLabel={breadcrumbCategoryLabel}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-10 mt-4 sm:mt-6">
        <Gallery images={p.images} alt={displayTitle} brand={p.brand} />

        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {p.brand && (
                // Brand chip is now a link to the brand-slice landing
                // (/search?brand=<brand>). Two wins: (a) every branded
                // product page becomes an internal-link vote for that brand
                // slice — those slices are sitemapped when they pass
                // MIN_FACET_COUNT=5 (see sitemap.ts) and canonical-self,
                // so the link routes PageRank into a Google-indexable
                // brand landing; (b) matches buyer expectation that
                // clicking a brand label surfaces other items from the
                // same brand. Styled subtly so it doesn't fight the H1
                // for attention.
                <Link
                  href={`/search?brand=${encodeURIComponent(p.brand)}`}
                  className="text-xs uppercase tracking-widest text-ink-mute font-medium hover:text-ink active:text-ink transition"
                >
                  {p.brand}
                </Link>
              )}
              <CounterfeitBadge risk={p.counterfeitRisk} />
            </div>
            <h1 dir="auto" className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight untrusted break-words">{displayTitle}</h1>
            {p.sellerId ? (
              <div className="mt-3 text-sm text-ink-soft">
                Vendu par{" "}
                <Link
                  href={`/store/${encodeURIComponent(p.sellerId)}`}
                  className="text-ink hover:text-accent active:text-accent underline-offset-4 hover:underline active:underline"
                >
                  {p.sellerDisplayName?.trim() ? p.sellerDisplayName : "ce vendeur"}
                </Link>
              </div>
            ) : (
              // Unowned reference listing (scraper-seeded). No store page to
              // link to, and the buy-flow is disabled further down the page.
              <div className="mt-3 text-sm text-ink-mute italic">
                Annonce de référence — non disponible à l’achat sur Teno Store
              </div>
            )}
            {(() => {
              // Algerian local-style display: drop +213 country code, prefix
              // a leading 0 (e.g. +213555000101 → 0555000101). The tel: and
              // wa.me hrefs keep the international format so dialing still
              // works from anywhere.
              const localizeDz = (n: string) => n.replace(/^\+?213/, "0").replace(/[^\d]/g, "");
              const waText = `Bonjour, je suis intéressé(e) par votre annonce « ${p.title.value} » sur Teno Store : ${SITE_URL}/product/${p.productId}`;

              // Build the per-channel call/WhatsApp/Viber chips from the
              // structured phone list when the API returned one. Fall back
              // to the legacy single-phone + single-whatsapp shape for older
              // catalog rows (and for tests / fixtures that haven't been
              // updated). A shop with two sales lines now shows two call
              // chips and (if both are flagged) two WhatsApp chips, instead
              // of silently dropping the second.
              type Chip =
                | { kind: "tel"; phone: string }
                | { kind: "wa"; phone: string }
                | { kind: "viber"; phone: string };
              const chips: Chip[] = [];
              if (p.sellerPhones && p.sellerPhones.length > 0) {
                const ordered = [...p.sellerPhones].sort((a, b) =>
                  a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1,
                );
                for (const ph of ordered) {
                  chips.push({ kind: "tel", phone: ph.phone });
                  if (ph.isWhatsapp) chips.push({ kind: "wa", phone: ph.phone });
                  if (ph.isViber) chips.push({ kind: "viber", phone: ph.phone });
                }
              } else {
                if (p.sellerPhone) chips.push({ kind: "tel", phone: p.sellerPhone });
                if (p.sellerWhatsapp) chips.push({ kind: "wa", phone: p.sellerWhatsapp });
              }
              // Unowned scraped listings (sellerId = NULL) have no seller record,
              // so sellerPhones/sellerPhone/sellerWhatsapp are all empty. The
              // scraper persists reachable phones on attributes.sourcePhones
              // (comma-joined), enforced as non-empty at insert time by
              // collectPhones() in packages/db/src/seed-from-scraped.ts. Surface
              // those as tel: chips so buyers can reach the original seller.
              if (chips.length === 0) {
                const raw = p.attributes?.sourcePhones?.value ?? "";
                for (const phone of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
                  chips.push({ kind: "tel", phone });
                }
              }
              const hasContact =
                chips.length > 0 ||
                (p.sellerWebsite && !/^https?:\/\/(www\.)?example\.(com|org|dz|net)\b/i.test(p.sellerWebsite));

              if (!hasContact) {
                return (
                  <div className="mt-3"><ShareButton title={p.title.value} url={`${SITE_URL}/product/${encodeURIComponent(p.productId)}`} /></div>
                );
              }
              return (
              <address className="mt-3 flex flex-wrap gap-2 not-italic">
                {chips.map((chip, idx) => {
                  if (chip.kind === "tel") {
                    return (
                      <a
                        key={`tel-${chip.phone}-${idx}`}
                        href={`tel:${chip.phone}`}
                        aria-label={`Appeler ${p.sellerDisplayName ?? "le vendeur"} au ${chip.phone}`}
                        className="inline-flex items-center gap-1.5 px-3.5 h-11 sm:h-8 rounded-full bg-bg-elev border border-line-soft text-sm sm:text-xs text-ink-soft hover:border-accent/40 hover:text-ink active:border-accent/40 active:text-ink transition"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                        <span className="font-mono tabular-nums tracking-tight" dir="ltr">{localizeDz(chip.phone)}</span>
                      </a>
                    );
                  }
                  if (chip.kind === "wa") {
                    return (
                      <a
                        key={`wa-${chip.phone}-${idx}`}
                        href={`https://wa.me/${chip.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(waText)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Contacter ${p.sellerDisplayName ?? "le vendeur"} sur WhatsApp au ${chip.phone} (s'ouvre dans un nouvel onglet)`}
                        className="inline-flex items-center gap-1.5 px-3.5 h-11 sm:h-8 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-sm sm:text-xs text-emerald-400 hover:bg-emerald-500/20 active:bg-emerald-500/25 transition"
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.2-.7.1-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.4-1.5-.9-.8-1.5-1.8-1.6-2.1-.2-.3 0-.4.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5 4.5 1.7.7 2.4.8 3.3.7.5-.1 1.7-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 4.9L2 22l5.3-1.4c1.4.7 2.9 1.1 4.7 1.1 5.5 0 10-4.5 10-10S17.5 2 12 2z"/></svg>
                        <span className="font-mono tabular-nums tracking-tight" dir="ltr">{localizeDz(chip.phone)}</span>
                      </a>
                    );
                  }
                  // Viber deep-link uses the viber://chat?number=… scheme.
                  return (
                    <a
                      key={`viber-${chip.phone}-${idx}`}
                      href={`viber://chat?number=${encodeURIComponent(chip.phone)}`}
                      aria-label={`Contacter ${p.sellerDisplayName ?? "le vendeur"} sur Viber au ${chip.phone}`}
                      className="inline-flex items-center gap-1.5 px-3.5 h-11 sm:h-8 rounded-full bg-violet-500/10 border border-violet-500/30 text-sm sm:text-xs text-violet-300 hover:bg-violet-500/20 active:bg-violet-500/25 transition"
                    >
                      <span className="font-mono tabular-nums tracking-tight" dir="ltr">Viber {localizeDz(chip.phone)}</span>
                    </a>
                  );
                })}
                {p.sellerWebsite && !/^https?:\/\/(www\.)?example\.(com|org|dz|net)\b/i.test(p.sellerWebsite) && (
                  <a
                    href={p.sellerWebsite}
                    target="_blank"
                    rel="nofollow ugc noopener noreferrer"
                    aria-label={`Site web de ${p.sellerDisplayName ?? "le vendeur"} (s'ouvre dans un nouvel onglet)`}
                    className="inline-flex items-center gap-1.5 px-3.5 h-11 sm:h-8 rounded-full bg-bg-elev border border-line-soft text-sm sm:text-xs text-ink-soft hover:border-accent/40 hover:text-ink active:border-accent/40 active:text-ink transition"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    Site web
                  </a>
                )}
                <ShareButton title={p.title.value} url={`${SITE_URL}/product/${encodeURIComponent(p.productId)}`} />
              </address>
              );
            })()}
          </div>

          <div className="flex items-baseline gap-4">
            <div className="text-3xl font-semibold tracking-tight">{priceLabel}</div>
            <div className={`text-xs uppercase tracking-widest font-medium ${inStockVariants.length ? "text-ok" : "text-ink-mute"}`}>
              {inStockVariants.length
                ? `${inStockVariants.length} variante${inStockVariants.length === 1 ? "" : "s"} en stock`
                : "Actuellement en rupture de stock"}
            </div>
          </div>

          {(() => {
            // Single add-to-cart button targets the cheapest in-stock variant
            // (or the cheapest overall, disabled, if nothing is in stock).
            // Buyers who need a specific variant get per-row buttons in the
            // variants table below.
            //
            // Unowned reference listings (p.sellerId == null) are excluded —
            // they live in the catalog as discoverability/SEO data but cannot
            // be purchased. The cart API would refuse the variant anyway
            // (see resolveLine → unowned_product); hiding the button here
            // keeps the UI honest and avoids the user-facing error path.
            if (!p.sellerId) return null;
            const target = inStockVariants[0] ?? variants[0];
            if (!target) return null;
            const inStock = inStockVariants.length > 0;
            return (
              // Primary action: Add to cart (lands on /cart for multi-item
              // shoppers). Secondary: Buy now goes straight to /checkout,
              // skipping the cart page for the common one-product COD path.
              <div className="flex flex-wrap items-center gap-2">
                <AddToCart variantId={target.id} inStock={inStock} />
                <AddToCart
                  variantId={target.id}
                  inStock={inStock}
                  label="Acheter maintenant"
                  redirectTo="/checkout"
                  className="[&>button]:bg-transparent [&>button]:border [&>button]:border-accent/60 [&>button]:text-accent [&>button]:hover:bg-accent/10 [&>button]:hover:brightness-100 [&>button]:active:bg-accent/20 [&>button]:active:brightness-100"
                />
              </div>
            );
          })()}

          {(() => {
            const postedIso = p.attributes?.sourcePostedAt?.value ?? null;
            const posted = formatRelativeTime(postedIso);
            return posted ? (
              <time dateTime={postedIso ?? undefined} className="text-xs text-ink-mute">
                Publié {posted}
              </time>
            ) : null;
          })()}

          {p.description && (
            <div className="rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-5">
              <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-2">Description</h2>
              <p dir="auto" className="text-sm leading-relaxed text-ink-soft whitespace-pre-line untrusted">
                {stripMaskedContactLines(p.description.value)}
              </p>
            </div>
          )}

          {variants.length > 1 && (
            <section>
              <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-3">Variants</h2>
              <div className="rounded-2xl border border-line-soft overflow-x-auto">
                <table className="w-full text-sm min-w-[28rem]">
                  <caption className="sr-only">Product variants — SKU, price, and stock status</caption>
                  <thead className="bg-bg-elev text-ink-soft text-xs uppercase tracking-wider">
                    <tr>
                      <th scope="col" className="text-left px-4 py-2 font-medium">SKU</th>
                      <th scope="col" className="text-right px-4 py-2 font-medium">Price</th>
                      <th scope="col" className="text-right px-4 py-2 font-medium">Stock</th>
                      <th scope="col" className="text-right px-4 py-2 font-medium"><span className="sr-only">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((v, i) => (
                      <tr key={v.id} className={i > 0 ? "border-t border-line-soft" : ""}>
                        <td className="px-4 py-3 font-mono text-xs text-ink-soft">{v.sku}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatPrice(v.priceMinor, v.currency)}</td>
                        <td className="px-4 py-3 text-right">
                          {v.inStock ? (
                            <span className="text-ok text-xs">
                              <span aria-hidden>●</span> in stock
                            </span>
                          ) : (
                            <span className="text-ink-mute text-xs">
                              <span aria-hidden>○</span> out
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {p.sellerId ? (
                            <AddToCart variantId={v.id} inStock={v.inStock} label="Ajouter" />
                          ) : (
                            <span className="text-xs text-ink-mute">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {(() => {
            const visibleAttrs = Object.entries(p.attributes).filter(
              ([k]) => !k.startsWith("source"),
            );
            if (visibleAttrs.length === 0) return null;
            return (
              <section>
                <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-3">Specifications</h2>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-5">
                  {visibleAttrs.map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3 py-1 border-b border-line-soft last:border-0">
                      <dt className="text-xs text-ink-mute capitalize break-words min-w-0">{k.replace(/_/g, " ")}</dt>
                      <dd className="text-sm text-ink-soft text-right break-words min-w-0 untrusted">{v.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })()}

          {p.shipsTo.length > 0 && (
            <section className="text-xs text-ink-mute">
              {p.shipsTo.length >= 50
                ? "Livraison mondiale"
                : `Livraison vers ${p.shipsTo.slice(0, 6).join(", ")}${p.shipsTo.length > 6 ? ` +${p.shipsTo.length - 6} autres` : ""}`}
            </section>
          )}

          {p.sellerId && (
            <div className="text-xs text-ink-mute pt-4 border-t border-line-soft">
              <Link href={`/store/${encodeURIComponent(p.sellerId)}`} className="hover:text-accent active:text-accent">
                Plus d&rsquo;annonces de {p.sellerDisplayName ?? "ce vendeur"} →
              </Link>
            </div>
          )}
        </div>
      </div>
      <Suspense fallback={null}>
        <RelatedProducts
          productId={p.productId}
          sellerId={p.sellerId}
          sellerDisplayName={p.sellerDisplayName ?? null}
          categoryId={p.categoryIds[0] ?? null}
        />
      </Suspense>
    </div>
  );
}

async function RelatedProducts({
  productId,
  sellerId,
  sellerDisplayName,
  categoryId,
}: {
  productId: string;
  sellerId: string | null;
  sellerDisplayName: string | null;
  categoryId: string | null;
}) {
  let relatedHits: SearchHit[] = [];
  try {
    // searchProductsCached: same (sellerId, sort:newest) tuple is hit by
    // EVERY product render from that seller. Smart Phone DZ has 4,800+
    // products → 4,800 identical fetches per crawl wave without this
    // cache. iter-29 API overload mitigation.
    //
    // For unowned listings (sellerId == null) we skip the seller slice and
    // go straight to the category fallback — there's no "seller" to fetch
    // sibling items from.
    const sellerSlice = sellerId
      ? await searchProductsCached({ sellerId: [sellerId], limit: 9, sort: "newest" })
      : { data: [] as SearchHit[] };
    relatedHits = sellerSlice.data.filter((h) => h.productId !== productId).slice(0, 8);
    if (relatedHits.length < 4 && categoryId) {
      const catSlice = await searchProductsCached({ category: [categoryId], limit: 12, sort: "newest" });
      const seen = new Set([productId, ...relatedHits.map((h) => h.productId)]);
      for (const h of catSlice.data) {
        if (relatedHits.length >= 8) break;
        if (!seen.has(h.productId)) {
          relatedHits.push(h);
          seen.add(h.productId);
        }
      }
    }
  } catch {
    // API hiccup — page still renders without the related grid.
    return null;
  }
  if (relatedHits.length === 0) return null;
  return (
    <section className="mt-16 border-t border-line-soft pt-10" aria-labelledby="related-heading">
      <div className="flex items-baseline justify-between mb-4">
        <h2 id="related-heading" className="text-xl font-semibold tracking-tight">
          {sellerDisplayName ? `Plus d'annonces de ${sellerDisplayName}` : "Plus d'annonces"}
        </h2>
        {sellerId && (
          <Link
            href={`/store/${encodeURIComponent(sellerId)}`}
            className="inline-flex items-center h-9 sm:h-8 text-sm text-ink-soft hover:text-ink active:text-ink transition"
          >
            Voir tout →
          </Link>
        )}
      </div>
      <ProductGrid hits={relatedHits} />
    </section>
  );
}

function Breadcrumbs({
  title,
  categorySlug,
  categoryLabel,
}: {
  title: string;
  categorySlug: string | null;
  categoryLabel: string | null;
}) {
  return (
    <nav aria-label="Fil d'Ariane" className="text-xs text-ink-mute flex items-center gap-x-2 gap-y-0 flex-wrap">
      <Link href="/" className="py-1 hover:text-ink-soft active:text-ink-soft">Accueil</Link>
      <span aria-hidden>/</span>
      <Link href="/search" className="py-1 hover:text-ink-soft active:text-ink-soft">Catalogue</Link>
      {categorySlug && categoryLabel && (
        <>
          <span aria-hidden>/</span>
          <Link
            href={`/c/${encodeURIComponent(categorySlug)}`}
            className="py-1 hover:text-ink-soft active:text-ink-soft"
          >
            {categoryLabel}
          </Link>
        </>
      )}
      <span aria-hidden>/</span>
      <span aria-current="page" className="py-1 text-ink-soft truncate max-w-[40ch]">{title}</span>
    </nav>
  );
}
