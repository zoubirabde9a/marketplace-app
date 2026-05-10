// Home page. Two states:
//   - signed in:  personalized "Hi, <name>" header + agent list + activity feed
//   - signed out: marketing landing with WebSite JSON-LD + sign-in CTA
//
// Auth state is read from the mp_session cookie via getCurrentUser(). The home
// page is always dynamic (cookies are per-request).

import Link from "next/link";
import { getCurrentUser } from "@/lib/sellerSession";
import { getMyActivity, searchProducts } from "@/lib/api";
import type { SearchHit } from "@/lib/api";
import { AgentActivity } from "@/components/AgentActivity";
import { ProductGrid } from "@/components/ProductGrid";
import { jsonLdString } from "@/lib/jsonld";

export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

export default async function Home() {
  const me = await getCurrentUser();

  if (me) {
    let activity;
    try {
      activity = await getMyActivity(me.jwt);
    } catch {
      // API hiccup — degrade gracefully to the empty-state view rather than crashing the home page.
      activity = { user: { id: me.user.id, email: me.user.email, displayName: me.user.displayName, picture: me.user.picture }, agents: [], recentActions: [] };
    }
    return <AgentActivity data={activity} />;
  }

  let recent: SearchHit[] = [];
  try {
    const r = await searchProducts({ sort: "newest", limit: 8 });
    recent = r.data ?? [];
  } catch {
    // API hiccup — landing still renders without the recent strip.
  }

  return <SignedOutLanding recent={recent} />;
}

function SignedOutLanding({ recent }: { recent: SearchHit[] }) {
  // Emit WebSite + Organization in a single @graph payload so Google can
  // resolve "Teno Store" as a knowledge-graph entity AND wire up SearchAction
  // sitelinks search box from one document.
  // The "Recently posted" strip is the freshest content on the site; surface
  // it to search engines so the home page contributes to topical-freshness
  // ranking signals beyond the marketing hero.
  // Each ListItem nests a full Product (image, brand, price/currency/
  // availability, seller) instead of a bare {url, name} pair. Mirrors the
  // /search slice ItemList shape so the home page contributes the same
  // rich-result-eligible payload to Google's structured-data graph as
  // the slice landings do — and the home page has the highest PageRank.
  const minorToMajor = (minor: string | undefined) => {
    if (!minor) return undefined;
    const n = Number(minor);
    if (!Number.isFinite(n)) return undefined;
    return (n / 100).toFixed(2);
  };
  const recentItemList = recent.length > 0 ? {
    "@type": "ItemList",
    "@id": `${SITE_URL}/#recent`,
    name: "Recently posted on Teno Store",
    numberOfItems: recent.length,
    itemListElement: recent.map((hit, idx) => {
      const productUrl = `${SITE_URL}/product/${encodeURIComponent(hit.productId)}`;
      const product: Record<string, unknown> = {
        "@type": "Product",
        "@id": productUrl,
        name: hit.title?.value,
        url: productUrl,
        productID: hit.productId,
      };
      if (hit.heroImageUrl) product.image = [hit.heroImageUrl];
      if (hit.brand) product.brand = { "@type": "Brand", name: hit.brand };
      const availability = hit.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock";
      const seller = hit.sellerDisplayName
        ? {
            "@type": "Organization",
            name: hit.sellerDisplayName,
            identifier: hit.sellerId,
            url: `${SITE_URL}/search?sellerId=${encodeURIComponent(hit.sellerId)}`,
          }
        : undefined;
      const flatPrice = minorToMajor(hit.priceMinor);
      const lowPrice = minorToMajor(hit.priceFromMinor);
      const highPrice = minorToMajor(hit.priceToMinor);
      if (lowPrice && highPrice && hit.currency && (hit.variantCount ?? 0) > 1) {
        product.offers = {
          "@type": "AggregateOffer",
          offerCount: hit.variantCount,
          lowPrice,
          highPrice,
          priceCurrency: hit.currency,
          availability,
          url: productUrl,
          ...(seller ? { seller } : {}),
        };
      } else if ((flatPrice ?? lowPrice) && hit.currency) {
        product.offers = {
          "@type": "Offer",
          price: flatPrice ?? lowPrice,
          priceCurrency: hit.currency,
          availability,
          url: productUrl,
          ...(seller ? { seller } : {}),
        };
      }
      return {
        "@type": "ListItem",
        position: idx + 1,
        item: product,
      };
    }),
  } : null;

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: "Teno Store",
        alternateName: "Teno Store — agent observer",
        description:
          "Teno Store is an agent-to-agent marketplace. Watch what your AI agent is searching, browsing and buying in real time.",
        url: SITE_URL,
        publisher: { "@id": `${SITE_URL}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "Teno Store",
        url: SITE_URL,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_URL}/icon.svg`,
        },
        // Regional entity signals for Google's knowledge graph. The catalog
        // serves Algerian buyers and sellers exclusively (currency=DZD,
        // listings sourced from Algerian marketplaces); without these
        // fields the Organization is locale-anonymous and Google can't
        // disambiguate "Teno Store" from the German jewelry brand TeNo
        // (teno.com — see deploy/seo.md).
        address: {
          "@type": "PostalAddress",
          addressCountry: "DZ",
        },
        areaServed: {
          "@type": "Country",
          name: "Algeria",
        },
        currenciesAccepted: "DZD",
        knowsLanguage: ["fr", "ar", "en"],
        email: "mahlledz@gmail.com",
      },
      ...(recentItemList ? [recentItemList] : []),
    ],
  };

  // Preload the first eager product card's hero image — that's the home
  // page LCP element on viewports where the recent strip is in-view. The
  // browser only sees the <img> URL when it parses the recent-strip section
  // (~30KB into the document); preloading from the head shaves ~50-100ms
  // off LCP on cold visits. imageSrcSet/imageSizes left off because all
  // ProductCard images render at the same size.
  const lcpImageUrl = recent[0]?.heroImageUrl;
  return (
    <section className="relative">
      {lcpImageUrl ? (
        <link
          rel="preload"
          as="image"
          href={lcpImageUrl}
          // crossOrigin matches the CDN preconnect crossorigin from layout.
          crossOrigin="anonymous"
          // High priority so the browser doesn't deprioritise it relative
          // to JS chunks Next.js also preloads.
          fetchPriority="high"
        />
      ) : null}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(websiteJsonLd) }}
      />
      <div className="absolute inset-0 bg-grid opacity-50 pointer-events-none [mask-image:radial-gradient(closest-side,black,transparent)]" />
      <div className="relative pt-24 pb-16 text-center max-w-3xl mx-auto">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs text-accent bg-accent/10 border border-accent/30 mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" /> live
        </span>
        <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight bg-gradient-to-b from-ink to-ink-soft bg-clip-text text-transparent">
          Watch your agent shop, in real time.
        </h1>
        <p className="mt-5 text-lg text-ink-soft leading-relaxed">
          See every search, every product, every price your agent looked at — exactly as it saw them.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/login"
            className="inline-flex h-11 px-5 items-center rounded-xl bg-accent text-bg font-medium hover:bg-accent-hover transition shadow-glow"
          >
            Sign in to see your agent →
          </Link>
          <Link
            href="/search"
            className="inline-flex h-11 px-5 items-center rounded-xl bg-bg-soft border border-line text-ink-soft hover:border-accent/40 hover:text-ink transition"
          >
            Browse the catalog
          </Link>
        </div>
      </div>
      {/* Topical content sits IMMEDIATELY after the hero's H1+buttons, BEFORE
          the agent-narrative Card grid. Iter probe found Google's primary
          on-page signals (first H1, first H2, first paragraph) were carrying
          three English agent-pitch H2s before any Algerian-marketplace /
          French content surfaced. With this order: hero (H1) → topical
          block (catalog H2 + French paragraph + category chips) → agent
          cards (H2s) → recent strip. The catalog signal now reaches
          crawlers before the agent narrative. */}
      <section className="mt-12 max-w-4xl mx-auto" aria-labelledby="catalog-heading">
        <h2 id="catalog-heading" className="text-2xl font-semibold tracking-tight mb-3">
          Marketplace algérien · annonces actualisées en temps réel
        </h2>
        <p lang="fr" className="text-ink-soft leading-relaxed mb-3">
          Découvrez des milliers d&rsquo;annonces de vendeurs algériens — téléphones,
          informatique, électroménager, mode, véhicules et plus. Prix en dinars (DZD),
          listings actualisés en continu depuis les principales places de marché du
          pays. Filtrez par marque, prix, vendeur ou catégorie pour trouver exactement
          ce que vous cherchez.
        </p>
        <p className="text-sm text-ink-mute leading-relaxed">
          Browse a continuously-refreshed catalog of consumer goods listed for sale
          in Algeria — phones, computing, home appliances, fashion and vehicles —
          priced in DZD, sourced from real Algerian sellers. Built API-first so AI
          agents can shop on a buyer&rsquo;s behalf via MCP, A2A and AP2.
        </p>
        <ul className="mt-5 flex flex-wrap gap-2 list-none p-0">
          {[
            ["Téléphones", "telephones"],
            ["Smartphones", "smartphones"],
            ["Informatique", "informatique"],
            ["Ordinateurs portables", "portables"],
            ["Électroménager", "electromenager"],
            ["Mode", "mode"],
            ["Maison & Déco", "maison"],
            ["Véhicules", "vehicules"],
          ].map(([label, slug]) => (
            <li key={slug}>
              <Link
                href={`/search?category=${encodeURIComponent(slug)}`}
                className="inline-flex items-center px-3 h-9 rounded-full bg-bg-soft border border-line-soft text-sm text-ink-soft hover:border-accent/40 hover:text-ink transition"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-16 max-w-4xl mx-auto" aria-labelledby="agent-heading">
        <h2 id="agent-heading" className="sr-only">How the agent observer works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          <Card title="Deep-linked searches" body="When your agent narrows a search, you get a URL that mirrors the same filters and results." />
          <Card title="Full product detail" body="Photos, variants, prices, attributes, and seller info — exactly what the agent saw." />
          <Card title="Trust signals" body="Counterfeit risk, stock state, and seller-supplied content tagged as untrusted by default." />
        </div>
      </section>
      {recent.length > 0 && (
        <section className="mt-12" aria-labelledby="recent-heading">
          <div className="flex items-baseline justify-between mb-4">
            <h2 id="recent-heading" className="text-xl font-semibold tracking-tight">Recently posted</h2>
            <Link href="/search" className="text-sm text-ink-soft hover:text-ink transition">See all →</Link>
          </div>
          <ProductGrid hits={recent} />
        </section>
      )}
    </section>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-line-soft bg-bg-soft/60 p-5 backdrop-blur hover:border-line transition">
      <h2 className="font-medium text-ink mb-1">{title}</h2>
      <p className="text-sm text-ink-soft leading-relaxed">{body}</p>
    </div>
  );
}
