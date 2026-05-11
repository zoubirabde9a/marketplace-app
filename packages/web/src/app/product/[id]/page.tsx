import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, type SearchHit } from "@/lib/api";
import { searchProductsCached } from "@/lib/searchCache";
import { formatPrice, formatPriceRange, formatRelativeTime } from "@/lib/format";
import { Gallery } from "@/components/Gallery";
import { CounterfeitBadge } from "@/components/CounterfeitBadge";
import { ShareButton } from "@/components/ShareButton";
import { ProductGrid } from "@/components/ProductGrid";
import { jsonLdString } from "@/lib/jsonld";

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

interface Params { id: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const p = await getProduct(id).catch(() => null);
  if (!p) notFound();
  const fullTitle = p.title.value;
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
    const raw = p.description?.value
      ?.replace(/\s+/g, " ")
      .replace(/^[\s\p{P}\p{S}]+/u, "")
      .trim();
    if (!raw) return raw;
    if (raw.length <= DESC_BUDGET) return raw;
    const cut = raw.slice(0, DESC_BUDGET);
    const space = cut.lastIndexOf(" ");
    return (space > 80 ? cut.slice(0, space) : cut).replace(/[\s\p{P}\p{S}]+$/u, "") + "…";
  })();
  // Live probe found products that ship a 0-char meta description (seller
  // posted no body text, or the body was nothing but emoji and got
  // stripped by the punctuation-leading regex). Without a description
  // Google falls back to scraping the page body for a snippet — usually
  // grabs the breadcrumb and footer chips, which makes for a terrible SERP
  // preview. Build a structured fallback from the data we already have.
  const desc = cleanedDesc && cleanedDesc.length > 0
    ? cleanedDesc
    : (() => {
        const parts: string[] = [];
        parts.push(fullTitle);
        if (p.brand) parts.push(`brand ${p.brand}`);
        if (p.sellerDisplayName) parts.push(`from ${p.sellerDisplayName}`);
        const lowest = [...p.variants].sort(
          (a, b) => Number(a.priceMinor) - Number(b.priceMinor),
        )[0];
        if (lowest) {
          // Ouedkniss often omits price ("Prix sur demande" / negotiate). Emitting
          // "0 DZD" in the meta description suggests the item is free and makes
          // for an embarrassing SERP snippet. Substitute the French convention
          // when no real price exists.
          const priceMinorNum = Number(lowest.priceMinor);
          if (Number.isFinite(priceMinorNum) && priceMinorNum >= MIN_REAL_PRICE_MINOR) {
            const price = (priceMinorNum / 100).toLocaleString("fr-DZ");
            parts.push(`${price} ${lowest.currency}`);
          } else {
            parts.push("Prix sur demande");
          }
        }
        return `${parts.join(" · ")} — listed on Teno Store, the agent-to-agent marketplace for Algerian sellers.`;
      })();
  // Resolve full hero metadata (width/height/alt) so social previews can size
  // the image without a round-trip and avoid Facebook "image too small" warnings.
  const heroImage = p.heroImageUrl
    ? p.images.find((img) => img.url === p.heroImageUrl) ?? null
    : null;
  const images = p.heroImageUrl
    ? [
        {
          url: p.heroImageUrl,
          ...(heroImage?.width ? { width: heroImage.width } : {}),
          ...(heroImage?.height ? { height: heroImage.height } : {}),
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
  const ogPriceAmount = Number.isFinite(minorPriceNum) && minorPriceNum >= MIN_REAL_PRICE_MINOR
    ? (minorPriceNum / 100).toFixed(2)
    : undefined;
  const anyInStockMeta = p.variants.some((v) => v.inStock);
  const ogProductOther: Record<string, string> = {
    "og:type": "product",
  };
  if (ogPriceAmount && minorVariant?.currency) {
    ogProductOther["product:price:amount"] = ogPriceAmount;
    ogProductOther["product:price:currency"] = minorVariant.currency;
    ogProductOther["og:price:amount"] = ogPriceAmount;
    ogProductOther["og:price:currency"] = minorVariant.currency;
  }
  ogProductOther["product:availability"] = anyInStockMeta ? "instock" : "oos";
  if (p.brand) ogProductOther["product:brand"] = p.brand;
  if (p.categoryIds.length > 0 && p.categoryIds[0]) {
    ogProductOther["product:category"] = p.categoryIds[0].replace(/[-_]/g, " ");
  }
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
      ...(p.heroImageUrl ? { images: [p.heroImageUrl] } : {}),
    },
    other: ogProductOther,
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

  // Pull a small grid of related listings from the same seller for crawl-path
  // density and human discovery. With ~5,000 products and Googlebot's crawl
  // budget, every product-to-product link helps the deep catalog get indexed
  // faster than the sitemap alone can drive. Falls back to first-category
  // siblings if the seller only has this one listing; renders nothing on
  // API hiccup.
  let relatedHits: SearchHit[] = [];
  try {
    // searchProductsCached: same (sellerId, sort:newest) tuple is hit by
    // EVERY product render from that seller. Smart Phone DZ has 4,800+
    // products → 4,800 identical fetches per crawl wave without this
    // cache. iter-29 API overload mitigation.
    const sellerSlice = await searchProductsCached({ sellerId: [p.sellerId], limit: 9, sort: "newest" });
    relatedHits = sellerSlice.data.filter((h) => h.productId !== p.productId).slice(0, 8);
    if (relatedHits.length < 4 && p.categoryIds[0]) {
      const catSlice = await searchProductsCached({ category: [p.categoryIds[0]], limit: 12, sort: "newest" });
      const seen = new Set([p.productId, ...relatedHits.map((h) => h.productId)]);
      for (const h of catSlice.data) {
        if (relatedHits.length >= 8) break;
        if (!seen.has(h.productId)) {
          relatedHits.push(h);
          seen.add(h.productId);
        }
      }
    }
  } catch {
    // ignore — page still renders without the related grid
  }

  const variants = [...p.variants].sort((a, b) => Number(a.priceMinor) - Number(b.priceMinor));
  const inStockVariants = variants.filter((v) => v.inStock);
  const minPrice = variants[0]?.priceMinor;
  const maxPrice = variants[variants.length - 1]?.priceMinor;
  const currency = variants[0]?.currency ?? "USD";
  const priceLabel = variants.length > 1
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
  // Skip the Offer/AggregateOffer block entirely when no variant has a real
  // price. Emitting Offer with price="0.00" misrepresents Ouedkniss "Prix sur
  // demande" listings as free items in Google rich results, Pinterest cards,
  // and shopping aggregators. Without an Offer, the Product node still ranks
  // for the rich-result eligibility on the Product type (name, image, brand,
  // description) — just without a price line in the snippet.
  const hasRealPrice = variants.some((v) => {
    const n = Number(v.priceMinor);
    return Number.isFinite(n) && n >= MIN_REAL_PRICE_MINOR;
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
          ...(variants[0].sku ? { sku: variants[0].sku } : {}),
          url: `${SITE_URL}/product/${encodeURIComponent(p.productId)}`,
          ...(p.sellerDisplayName
            ? {
                seller: {
                  "@type": "Organization",
                  name: p.sellerDisplayName,
                  identifier: p.sellerId,
                  url: `${SITE_URL}/search?sellerId=${encodeURIComponent(p.sellerId)}`,
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
          url: `${SITE_URL}/product/${encodeURIComponent(p.productId)}`,
          ...(p.sellerDisplayName
            ? {
                seller: {
                  "@type": "Organization",
                  name: p.sellerDisplayName,
                  identifier: p.sellerId,
                  url: `${SITE_URL}/search?sellerId=${encodeURIComponent(p.sellerId)}`,
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
  };
  if (p.description?.value) productJsonLd.description = p.description.value;
  if (p.images && p.images.length > 0) {
    productJsonLd.image = p.images.map((img) => img.url);
  } else if (p.heroImageUrl) {
    productJsonLd.image = [p.heroImageUrl];
  }
  if (p.brand) {
    productJsonLd.brand = { "@type": "Brand", name: p.brand };
  }
  // Surface the primary category to schema.org's `category` field so Google
  // can place us in its product taxonomy (e.g. browse-card grouping).
  // categoryIds are slug-style ("telephones", "informatique") — humanise the
  // first segment for the JSON-LD payload.
  if (p.categoryIds.length > 0 && p.categoryIds[0]) {
    productJsonLd.category = p.categoryIds[0].replace(/[-_]/g, " ");
  }
  // Promote a single variant's SKU to the Product level so Google can match
  // this listing to known catalogs even without scanning the Offer.
  if (variants.length === 1 && variants[0].sku) {
    productJsonLd.sku = variants[0].sku;
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

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Catalog", item: `${SITE_URL}/search` },
      {
        "@type": "ListItem",
        position: 3,
        name: p.title.value,
        item: `${SITE_URL}/product/${encodeURIComponent(p.productId)}`,
      },
    ],
  };

  // Tag the article subtree with the content language so screen readers
  // pronounce French titles correctly even though <html lang="en"> at the
  // root. Currency-based heuristic mirrors the og:locale logic above.
  const contentLang = currency === "DZD" ? "fr" : undefined;
  // Also tag in the JSON-LD so search/AI agents have the same signal.
  if (contentLang) productJsonLd.inLanguage = contentLang;

  return (
    <div className="pt-8" lang={contentLang}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd) }}
      />
      <Breadcrumbs title={p.title.value} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mt-6">
        <Gallery images={p.images} alt={p.title.value} brand={p.brand} />

        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              {p.brand && <span className="text-xs uppercase tracking-widest text-ink-mute font-medium">{p.brand}</span>}
              <CounterfeitBadge risk={p.counterfeitRisk} />
            </div>
            <h1 dir="auto" className="text-3xl font-semibold tracking-tight leading-tight untrusted">{p.title.value}</h1>
            <div className="mt-3 text-sm text-ink-soft">
              Sold by{" "}
              <Link
                href={`/search?sellerId=${encodeURIComponent(p.sellerId)}`}
                className="text-ink hover:text-accent underline-offset-4 hover:underline"
              >
                {p.sellerDisplayName?.trim() ? p.sellerDisplayName : "this seller"}
              </Link>
            </div>
            {(p.sellerPhone || p.sellerWhatsapp || p.sellerWebsite) && (() => {
              // Algerian local-style display: drop +213 country code, prefix
              // a leading 0 (e.g. +213555000101 → 0555000101). The tel: and
              // wa.me hrefs keep the international format so dialing still
              // works from anywhere.
              const localizeDz = (n: string) => n.replace(/^\+?213/, "0").replace(/[^\d]/g, "");
              return (
              <address className="mt-3 flex flex-wrap gap-2 not-italic">
                {p.sellerPhone && (
                  <a
                    href={`tel:${p.sellerPhone}`}
                    aria-label={`Call ${p.sellerDisplayName ?? "seller"} at ${p.sellerPhone}`}
                    className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-bg-elev border border-line-soft text-xs text-ink-soft hover:border-accent/40 hover:text-ink transition"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    <span className="font-mono tabular-nums tracking-tight" dir="ltr">{localizeDz(p.sellerPhone)}</span>
                  </a>
                )}
                {p.sellerWhatsapp && (
                  <a
                    href={`https://wa.me/${p.sellerWhatsapp.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Bonjour / Hi! Interested in your "${p.title.value}" on Teno Store: ${SITE_URL}/product/${p.productId}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Message ${p.sellerDisplayName ?? "seller"} on WhatsApp (opens in new tab)`}
                    className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 hover:bg-emerald-500/20 transition"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.2-.7.1-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.4-1.5-.9-.8-1.5-1.8-1.6-2.1-.2-.3 0-.4.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5 4.5 1.7.7 2.4.8 3.3.7.5-.1 1.7-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 4.9L2 22l5.3-1.4c1.4.7 2.9 1.1 4.7 1.1 5.5 0 10-4.5 10-10S17.5 2 12 2z"/></svg>
                    <span className="font-mono tabular-nums tracking-tight" dir="ltr">{localizeDz(p.sellerWhatsapp)}</span>
                  </a>
                )}
                {p.sellerWebsite && !/^https?:\/\/(www\.)?example\.(com|org|dz|net)\b/i.test(p.sellerWebsite) && (
                  <a
                    href={p.sellerWebsite}
                    target="_blank"
                    rel="nofollow ugc noopener noreferrer"
                    aria-label={`${p.sellerDisplayName ?? "Seller"} website (opens in new tab)`}
                    className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-bg-elev border border-line-soft text-xs text-ink-soft hover:border-accent/40 hover:text-ink transition"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    Website
                  </a>
                )}
                <ShareButton title={p.title.value} url={`${SITE_URL}/product/${encodeURIComponent(p.productId)}`} />
              </address>
              );
            })()}
            {!(p.sellerPhone || p.sellerWhatsapp || p.sellerWebsite) && (
              <div className="mt-3"><ShareButton title={p.title.value} url={`${SITE_URL}/product/${encodeURIComponent(p.productId)}`} /></div>
            )}
          </div>

          <div className="flex items-baseline gap-4">
            <div className="text-3xl font-semibold tracking-tight">{priceLabel}</div>
            <div className={`text-xs uppercase tracking-widest font-medium ${inStockVariants.length ? "text-ok" : "text-ink-mute"}`}>
              {inStockVariants.length ? `${inStockVariants.length} variant${inStockVariants.length === 1 ? "" : "s"} in stock` : "Currently out of stock"}
            </div>
          </div>

          {(() => {
            const postedIso = p.attributes?.sourcePostedAt?.value ?? null;
            const posted = formatRelativeTime(postedIso);
            return posted ? (
              <time dateTime={postedIso ?? undefined} className="text-xs text-ink-mute">
                Posted {posted}
              </time>
            ) : null;
          })()}

          {p.description && (
            <div className="rounded-2xl border border-line-soft bg-bg-soft/60 p-5">
              <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-2">Description</h2>
              <p dir="auto" className="text-sm leading-relaxed text-ink-soft whitespace-pre-line untrusted">
                {p.description.value}
              </p>
            </div>
          )}

          {variants.length > 1 && (
            <section>
              <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-3">Variants</h2>
              <div className="rounded-2xl border border-line-soft overflow-hidden">
                <table className="w-full text-sm">
                  <caption className="sr-only">Product variants — SKU, price, and stock status</caption>
                  <thead className="bg-bg-elev text-ink-soft text-xs uppercase tracking-wider">
                    <tr>
                      <th scope="col" className="text-left px-4 py-2 font-medium">SKU</th>
                      <th scope="col" className="text-right px-4 py-2 font-medium">Price</th>
                      <th scope="col" className="text-right px-4 py-2 font-medium">Stock</th>
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
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 rounded-2xl border border-line-soft bg-bg-soft/60 p-5">
                  {visibleAttrs.map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3 py-1 border-b border-line-soft last:border-0">
                      <dt className="text-xs text-ink-mute capitalize">{k.replace(/_/g, " ")}</dt>
                      <dd className="text-sm text-ink-soft text-right untrusted">{v.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })()}

          {p.shipsTo.length > 0 && (
            <section className="text-xs text-ink-mute">
              {p.shipsTo.length >= 50
                ? "Ships worldwide"
                : `Ships to ${p.shipsTo.slice(0, 6).join(", ")}${p.shipsTo.length > 6 ? ` +${p.shipsTo.length - 6} more` : ""}`}
            </section>
          )}

          <div className="text-xs text-ink-mute pt-4 border-t border-line-soft">
            <Link href={`/search?sellerId=${encodeURIComponent(p.sellerId)}`} className="hover:text-accent">
              More from {p.sellerDisplayName ?? "this seller"} →
            </Link>
          </div>
        </div>
      </div>
      {relatedHits.length > 0 && (
        <section className="mt-16 border-t border-line-soft pt-10" aria-labelledby="related-heading">
          <div className="flex items-baseline justify-between mb-4">
            <h2 id="related-heading" className="text-xl font-semibold tracking-tight">
              {p.sellerDisplayName ? `More from ${p.sellerDisplayName}` : "More listings"}
            </h2>
            <Link
              href={`/search?sellerId=${encodeURIComponent(p.sellerId)}`}
              className="text-sm text-ink-soft hover:text-ink transition"
            >
              See all →
            </Link>
          </div>
          <ProductGrid hits={relatedHits} />
        </section>
      )}
    </div>
  );
}

function Breadcrumbs({ title }: { title: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-ink-mute flex items-center gap-2">
      <Link href="/" className="hover:text-ink-soft">Home</Link>
      <span aria-hidden>/</span>
      <Link href="/search" className="hover:text-ink-soft">Catalog</Link>
      <span aria-hidden>/</span>
      <span aria-current="page" className="text-ink-soft truncate max-w-[40ch]">{title}</span>
    </nav>
  );
}
