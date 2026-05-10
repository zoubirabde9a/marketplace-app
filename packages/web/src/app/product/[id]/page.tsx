import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct } from "@/lib/api";
import { formatPrice, formatPriceRange, formatRelativeTime } from "@/lib/format";
import { Gallery } from "@/components/Gallery";
import { CounterfeitBadge } from "@/components/CounterfeitBadge";
import { ShareButton } from "@/components/ShareButton";
import { jsonLdString } from "@/lib/jsonld";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

interface Params { id: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const p = await getProduct(id).catch(() => null);
  if (!p) notFound();
  const title = p.title.value;
  // Meta descriptions render as a single line in search/social previews, so
  // collapse whitespace and trim leading decorative symbols (✅, ✔️, ⭐, …)
  // that scraped seller copy tends to lead with — those break the snippet.
  const desc = p.description?.value
    ?.replace(/\s+/g, " ")
    .replace(/^[\s\p{P}\p{S}]+/u, "")
    .slice(0, 200)
    .trim();
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
          ...(heroImage?.altText ? { alt: heroImage.altText } : { alt: title }),
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
  const ogPriceAmount = minorVariant
    ? (Number(minorVariant.priceMinor) / 100).toFixed(2)
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
    title,
    description: desc,
    alternates: { canonical },
    openGraph: {
      title,
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
      title,
      description: desc,
      ...(p.heroImageUrl ? { images: [p.heroImageUrl] } : {}),
    },
    other: ogProductOther,
  };
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const p = await getProduct(id);
  if (!p) notFound();

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
  const itemCondition = "https://schema.org/NewCondition";
  const offers =
    variants.length === 1
      ? {
          "@type": "Offer",
          price: minorToMajor(variants[0].priceMinor),
          priceCurrency: variants[0].currency,
          availability: variants[0].inStock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          itemCondition,
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
          itemCondition,
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
