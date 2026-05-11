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

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const s = await getSeller(id).catch(() => null);
  if (!s) return { title: "Store not found", robots: { index: false, follow: false } };
  const locality = [s.city, s.countryCode].filter(Boolean).join(", ");
  const desc =
    s.description ||
    `Shop ${s.displayName}${locality ? ` in ${locality}` : ""} on Teno Store. ${s.productCount} listing${s.productCount === 1 ? "" : "s"}.`;
  return {
    title: s.displayName,
    description: desc.slice(0, 200),
    alternates: { canonical: `/store/${s.sellerId}` },
    openGraph: {
      title: s.displayName,
      description: desc.slice(0, 200),
      url: `${SITE_URL}/store/${s.sellerId}`,
      type: "website",
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
  const location = [seller.city, seller.countryCode].filter(Boolean).join(", ");

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

  return (
    <article className="max-w-6xl mx-auto p-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(storeJsonLd) }}
      />

      <header className="border-b border-line-soft pb-6 mb-6">
        <p className="text-xs uppercase tracking-widest text-ink-mute font-semibold">Store</p>
        <h1 className="text-3xl font-semibold mt-1">{seller.displayName}</h1>
        {location ? <p className="text-sm text-ink-soft mt-1">{location}</p> : null}
        {seller.description ? (
          <p className="mt-4 text-ink-soft whitespace-pre-wrap max-w-2xl">{seller.description}</p>
        ) : null}

        <dl className="mt-5 text-sm grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-4 gap-y-1 max-w-xl">
          {phones.length > 0 ? (
            <>
              <dt className="text-ink-mute">Phone{phones.length > 1 ? "s" : ""}</dt>
              <dd>
                <ul>
                  {phones.map((p) => (
                    <li key={p.phone}>
                      <a className="font-mono text-accent hover:underline" href={`tel:${p.phone}`}>{p.phone}</a>
                      {p.isPrimary ? <span className="text-xs text-ink-mute"> · primary</span> : null}
                      {p.isWhatsapp ? <span className="text-xs text-ink-mute"> · WhatsApp</span> : null}
                      {p.isViber ? <span className="text-xs text-ink-mute"> · Viber</span> : null}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          ) : seller.phone ? (
            <>
              <dt className="text-ink-mute">Phone</dt>
              <dd><a className="font-mono text-accent hover:underline" href={`tel:${seller.phone}`}>{seller.phone}</a></dd>
            </>
          ) : null}
          {seller.website ? (
            <>
              <dt className="text-ink-mute">Website</dt>
              <dd><a className="text-accent hover:underline" href={seller.website} rel="nofollow noopener">{seller.website}</a></dd>
            </>
          ) : null}
          {seller.supportEmail ? (
            <>
              <dt className="text-ink-mute">Support</dt>
              <dd><a className="text-accent hover:underline" href={`mailto:${seller.supportEmail}`}>{seller.supportEmail}</a></dd>
            </>
          ) : null}
        </dl>
      </header>

      <section>
        <h2 className="text-xl font-medium mb-4">
          {totalEstimate > 0
            ? `Listings (${totalEstimate})`
            : "No listings yet"}
        </h2>
        {hits.length > 0 ? (
          <ProductGrid hits={hits} />
        ) : (
          <p className="text-ink-soft">This store hasn’t published any products yet.</p>
        )}
        {totalEstimate > hits.length ? (
          <p className="mt-6">
            <Link className="text-accent hover:underline" href={`/search?sellerId=${seller.sellerId}`}>
              See all {totalEstimate} listings →
            </Link>
          </p>
        ) : null}
      </section>
    </article>
  );
}
