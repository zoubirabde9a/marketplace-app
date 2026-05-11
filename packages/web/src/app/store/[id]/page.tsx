// Public seller storefront. One URL per seller; this is the page a buyer
// (or an AI agent referring a human) lands on when they want to see a
// store's identity, contact channels, location, bio, and product grid.
//
// Distinct from /seller/* which is the auth/dashboard surface for the
// merchant themselves, and from /search?sellerId=... which is a filtered
// search results page. The storefront is the buyer-facing "shop" page.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSeller, searchProducts } from "@/lib/api";
import { ProductGrid } from "@/components/ProductGrid";
import { jsonLdString } from "@/lib/jsonld";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

interface Params { id: string }

// Map ISO 3166-1 alpha-2 country codes to their French name for display.
// The catalog is Algeria-primary so "DZ" is the dominant value; other codes
// fall back to the raw ISO code (sellers can flag this for a proper map if
// they expand outside Algeria).
function frCountry(cc: string | null | undefined): string | null {
  if (!cc) return null;
  const m: Record<string, string> = { DZ: "Algérie", FR: "France", TN: "Tunisie", MA: "Maroc" };
  return m[cc.toUpperCase()] ?? cc;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const s = await getSeller(id).catch(() => null);
  if (!s) return { title: "Boutique introuvable", robots: { index: false, follow: false } };
  // Display-friendly French locality. Joins city + French country name with
  // a comma; either side may be null. ISO country code passes through
  // frCountry() so prod meta description reads "Alger, Algérie" rather
  // than the bare ISO "DZ" that landed on Google's prior crawl.
  const locality = [s.city, frCountry(s.countryCode)].filter(Boolean).join(", ");
  // French preposition before the locality. With a city we use "à" ("à Alger"
  // or "à Alger, Algérie"). Without a city — locality is just the country —
  // we need the gendered "en"/"au"/"aux" forms ("en Algérie", "au Maroc").
  // "à Algérie" is ungrammatical and showed up on the prior crawl for
  // sellers who had countryCode but no city.
  const localityPrep = (() => {
    if (!locality) return "";
    if (s.city) return "à ";
    // Country-only — pick preposition by country.
    const cc = (s.countryCode ?? "").toUpperCase();
    // au + masculine: MA Maroc, CA Canada, JP Japon… (only MA in our map).
    if (cc === "MA") return "au ";
    // aux + plural-feminine/masculine: US États-Unis, NL Pays-Bas, AE Émirats…
    // (none in our map today).
    // en + feminine: DZ Algérie, FR France, TN Tunisie. Default.
    return "en ";
  })();
  const desc =
    s.description ||
    `Boutique ${s.displayName}${locality ? ` ${localityPrep}${locality}` : ""} sur Teno Store. ${s.productCount} annonce${s.productCount === 1 ? "" : "s"} en dinars algériens (DZD).`;
  return {
    title: s.displayName,
    description: desc.slice(0, 200),
    alternates: { canonical: `/store/${s.sellerId}` },
    openGraph: {
      // Next.js metadata.openGraph REPLACES the layout default wholesale on
      // child pages (no shallow-merge of nested fields). Probed live before
      // this fix: no og:site_name, no og:image. Redeclare each field that
      // child pages need; matches the pattern from /search + /product.
      title: s.displayName,
      description: desc.slice(0, 200),
      url: `${SITE_URL}/store/${s.sellerId}`,
      type: "website",
      siteName: "Teno Store",
      locale: "fr_DZ",
      alternateLocale: ["ar_DZ", "en_US"],
      // og:image — without this, Twitter summary_large_image renders a
      // degraded card and FB/LinkedIn show no preview image. Use the
      // home opengraph-image route which renders the brand card at
      // 1200×630 (the spec minimum for summary_large_image).
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${s.displayName} — Teno Store` }],
    },
    twitter: {
      // Same shallow-merge gotcha — without explicit twitter.*, /store/{id}
      // share previews on X showed the layout-default brand pitch instead
      // of the seller's name.
      card: "summary_large_image",
      title: s.displayName,
      description: desc.slice(0, 200),
    },
  };
}

export default async function StorePage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const seller = await getSeller(id).catch(() => null);
  if (!seller) notFound();

  // Fetch up to 60 listings for this seller. We rely on the same /v1/products
  // search surface the search page uses (sellerId filter); that means
  // counterfeit-risk, hero image, and price-range rendering match exactly.
  const listings = await searchProducts({ sellerId: [seller.sellerId], limit: 60 }).catch(
    () => null,
  );
  const hits = listings?.data ?? [];
  const totalEstimate = listings?.pagination.totalEstimate ?? 0;

  const phones = seller.phones ?? [];
  // Visible location uses the French country name (frCountry()) so the
  // header reads "Alger, Algérie" rather than "Alger, DZ"; matches the
  // meta description and the rest of the French-locale page copy.
  const location = [seller.city, frCountry(seller.countryCode)].filter(Boolean).join(", ");

  const storeJsonLd = {
    "@context": "https://schema.org",
    "@type": "Store",
    "@id": `${SITE_URL}/store/${seller.sellerId}`,
    name: seller.displayName,
    url: `${SITE_URL}/store/${seller.sellerId}`,
    ...(seller.description ? { description: seller.description } : {}),
    ...(seller.website ? { sameAs: [seller.website] } : {}),
    ...(seller.supportEmail ? { email: seller.supportEmail } : {}),
    ...(phones[0]
      ? { telephone: phones[0].phone }
      : seller.phone
        ? { telephone: seller.phone }
        : {}),
    ...(seller.city || seller.countryCode
      ? {
          address: {
            "@type": "PostalAddress",
            ...(seller.city ? { addressLocality: seller.city } : {}),
            ...(seller.countryCode ? { addressCountry: seller.countryCode } : {}),
          },
        }
      : {}),
  };

  // ItemList of this seller's products. The /search?sellerId=... page (now
  // canonical-redirect to /store/{id}) shipped one with up to 25 nested
  // Product entries — each with name/url/image/brand/offers. Without it on
  // the new canonical URL, Google loses per-product structured-data
  // coverage from the seller-storefront entity, Shopping bucketing for
  // the seller's inventory, and the Brand→Seller relationship signal.
  // Price floor below 100 DZD treated as "Prix sur demande" (matches the
  // home / search / product / feed price-suppression policy).
  const minorToMajor = (minor: string | undefined): string | undefined => {
    if (!minor) return undefined;
    const n = Number(minor);
    if (!Number.isFinite(n) || n < 10000) return undefined;
    return (n / 100).toFixed(2);
  };
  const itemListJsonLd = hits.length > 0
    ? {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "@id": `${SITE_URL}/store/${seller.sellerId}#products`,
        name: `Annonces de ${seller.displayName}`,
        numberOfItems: hits.length,
        itemListElement: hits.slice(0, 25).map((hit, idx) => {
          const productUrl = `${SITE_URL}/product/${encodeURIComponent(hit.productId)}`;
          const product: Record<string, unknown> = {
            "@type": "Product",
            "@id": productUrl,
            name: hit.title?.value,
            url: productUrl,
            productID: hit.productId,
          };
          if (hit.heroImageUrl) {
            // Inline the same /400 → /1200 upscale used elsewhere so crawler-
            // facing image URLs hit the higher-resolution variant for Image
            // Search ranking. (Helper lives in lib/images but this file is
            // operator-managed; keeping the regex inline avoids touching
            // their import surface.)
            product.image = [hit.heroImageUrl.replace(
              /^(https?:\/\/cdn\d*\.ouedkniss\.com)\/\d{2,4}(\/medias\/)/,
              "$1/1200$2",
            )];
          }
          if (hit.brand) product.brand = { "@type": "Brand", name: hit.brand };
          const availability = hit.inStock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock";
          const flat = minorToMajor(hit.priceMinor);
          const low = minorToMajor(hit.priceFromMinor);
          const high = minorToMajor(hit.priceToMinor);
          if (low && high && hit.currency && (hit.variantCount ?? 0) > 1) {
            product.offers = {
              "@type": "AggregateOffer",
              offerCount: hit.variantCount,
              lowPrice: low,
              highPrice: high,
              priceCurrency: hit.currency,
              availability,
              url: productUrl,
            };
          } else if ((flat ?? low) && hit.currency) {
            product.offers = {
              "@type": "Offer",
              price: flat ?? low,
              priceCurrency: hit.currency,
              availability,
              url: productUrl,
            };
          }
          return { "@type": "ListItem", position: idx + 1, item: product };
        }),
      }
    : null;

  // BreadcrumbList for SERP rich-result row above the snippet
  // ("teno-store.com › Accueil › Catalogue › {seller}"). The /search?sellerId
  // page (now canonical-redirect to /store/{id} via commit efb4f54) had this
  // signal; preserving it on the new canonical URL avoids regressing the
  // rich-result coverage we already had.
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Catalogue", item: `${SITE_URL}/search` },
      { "@type": "ListItem", position: 3, name: seller.displayName, item: `${SITE_URL}/store/${seller.sellerId}` },
    ],
  };

  return (
    <article className="max-w-6xl mx-auto p-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(storeJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd) }}
      />
      {itemListJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(itemListJsonLd) }}
        />
      )}

      <header className="border-b border-line-soft pb-6 mb-6">
        <p className="text-xs uppercase tracking-widest text-ink-mute font-semibold">Boutique</p>
        <h1 className="text-3xl font-semibold mt-1">{seller.displayName}</h1>
        {location ? <p className="text-sm text-ink-soft mt-1">{location}</p> : null}
        {seller.description ? (
          <p className="mt-4 text-ink-soft whitespace-pre-wrap max-w-2xl">{seller.description}</p>
        ) : null}

        <dl className="mt-5 text-sm grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-4 gap-y-1 max-w-xl">
          {phones.length > 0 ? (
            <>
              <dt className="text-ink-mute">Téléphone{phones.length > 1 ? "s" : ""}</dt>
              <dd>
                <ul>
                  {phones.map((p) => (
                    <li key={p.phone}>
                      <a className="font-mono text-accent hover:underline" href={`tel:${p.phone}`}>{p.phone}</a>
                      {p.isPrimary ? <span className="text-xs text-ink-mute"> · principal</span> : null}
                      {p.isWhatsapp ? <span className="text-xs text-ink-mute"> · WhatsApp</span> : null}
                      {p.isViber ? <span className="text-xs text-ink-mute"> · Viber</span> : null}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          ) : seller.phone ? (
            <>
              <dt className="text-ink-mute">Téléphone</dt>
              <dd><a className="font-mono text-accent hover:underline" href={`tel:${seller.phone}`}>{seller.phone}</a></dd>
            </>
          ) : null}
          {seller.website ? (
            <>
              <dt className="text-ink-mute">Site web</dt>
              <dd><a className="text-accent hover:underline" href={seller.website} rel="nofollow noopener">{seller.website}</a></dd>
            </>
          ) : null}
          {seller.supportEmail ? (
            <>
              <dt className="text-ink-mute">Contact</dt>
              <dd><a className="text-accent hover:underline" href={`mailto:${seller.supportEmail}`}>{seller.supportEmail}</a></dd>
            </>
          ) : null}
        </dl>
      </header>

      <section>
        <h2 className="text-xl font-medium mb-4">
          {totalEstimate > 0
            ? `Annonces (${totalEstimate})`
            : "Pas encore d’annonces"}
        </h2>
        {hits.length > 0 ? (
          <ProductGrid hits={hits} />
        ) : (
          <p className="text-ink-soft">Cette boutique n’a pas encore publié d’annonces.</p>
        )}
        {totalEstimate > hits.length ? (
          <p className="mt-6">
            <Link className="text-accent hover:underline" href={`/search?sellerId=${seller.sellerId}`}>
              Voir les {totalEstimate} annonces →
            </Link>
          </p>
        ) : null}
      </section>
    </article>
  );
}
