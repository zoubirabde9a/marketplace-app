// Home page — the SEO landing. Always renders the marketing/catalog view; no
// per-request auth check, so Next.js + Cloudflare can fully edge-cache it.
//
// Signed-in users get redirected to `/dashboard` by middleware (which sees
// the `mp_session` cookie and rewrites). The dashboard lives at its own
// route so `/` itself can be ISR-cached: a single 60s revalidation window
// serves every crawler hit, every cold visitor, and every signed-out
// browsing session from one rendered HTML.
//
// Why this matters: with force-dynamic + per-request `getCurrentUser()`,
// every Googlebot / Bingbot / ChatGPT-User / PerplexityBot hit on `/` paid
// full SSR cost on origin even with the anonymous-cache middleware in
// front (because the page was tainted by `cookies()` access). Decoupling
// the auth check moves `/` into Next's full ISR path — origin renders
// once per minute; everything else is served from cache.

import Link from "next/link";
import { searchProducts } from "@/lib/api";
import type { SearchHit } from "@/lib/api";
import { ProductGrid } from "@/components/ProductGrid";
import { jsonLdString } from "@/lib/jsonld";
import { upscaleOuedknissForCrawler } from "@/lib/images";

// 60s ISR window. The catalog seed loop runs at minute cadence so the
// "Annonces récentes" strip's freshness budget aligns with how fast new
// listings actually arrive. Crawler-facing edge cache (5 min s-maxage in
// middleware.ts) sits on top of this.
export const revalidate = 60;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

export default async function Home() {
  let recent: SearchHit[] = [];
  try {
    // noFacets: this strip doesn't render brand/price/seller facets, so let
    // the API skip the catalog-wide loadAll and hit a recent-products indexed
    // query instead. Drops cold-cache home-page TTFB from ~11s to sub-second.
    const r = await searchProducts({ sort: "newest", limit: 8, noFacets: true });
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
  // Match feed.xml + product/[id]/page.tsx MIN_REAL_PRICE_MINOR. Returns
  // undefined for priceMinor < 100 DZD (10000 santeem) so Ouedkniss
  // 'Prix sur demande' placeholders don't leak into the ItemList JSON-LD
  // as fake "$0.00" Offers on the home page's recent-listings strip.
  const minorToMajor = (minor: string | undefined) => {
    if (!minor) return undefined;
    const n = Number(minor);
    if (!Number.isFinite(n) || n < 10000) return undefined;
    return (n / 100).toFixed(2);
  };
  const recentItemList = recent.length > 0 ? {
    "@type": "ItemList",
    "@id": `${SITE_URL}/#recent`,
    name: "Annonces récentes sur Teno Store",
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
      if (hit.heroImageUrl) product.image = [upscaleOuedknissForCrawler(hit.heroImageUrl)];
      if (hit.brand) product.brand = { "@type": "Brand", name: hit.brand };
      const availability = hit.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock";
      const seller = hit.sellerId && hit.sellerDisplayName
        ? {
            "@type": "Organization",
            name: hit.sellerDisplayName,
            identifier: hit.sellerId,
            url: `${SITE_URL}/store/${encodeURIComponent(hit.sellerId)}`,
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
        alternateName: "Teno Store — marketplace algérien",
        // Site-level WebSite.description feeds Google's knowledge-graph
        // entity for the brand + AI-search panel summaries. Match the
        // French og:description shipped earlier so the brand entity
        // description is consistent with what social/SERP previews show.
        description:
          "Marketplace algérien — milliers d'annonces de téléphones, informatique, électroménager, mode et véhicules. Vendeurs algériens, prix en dinars (DZD). Conçu pour acheteurs humains et agents IA (MCP, A2A, AP2).",
        inLanguage: ["fr", "ar", "en"],
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
        // Declare the e-commerce nature of the entity via additionalType.
        // schema.org/OnlineStore is the subtype Google + AI commerce panels
        // (Bing Shopping, ChatGPT shopping, Perplexity buy-mode) recognise
        // for "online merchants". Keeping the primary @type as Organization
        // preserves the existing publisher backref in WebSite.publisher
        // and the cross-page isPartOf/about anchors that already resolve
        // to #organization; additionalType is the schema.org-blessed
        // mechanism for adding a secondary type without breaking refs.
        additionalType: "https://schema.org/OnlineStore",
        name: "Teno Store",
        // Short brand pitch, surfaced in Google knowledge-graph cards and
        // AI search entity summaries when the engine wants a one-liner
        // rather than the full description. Mirrors the French H1 visible
        // on the homepage so the slogan and the rendered hero align.
        slogan: "Marketplace algérien · annonces actualisées en temps réel",
        // Organization description for Google's knowledge-graph brand
        // entity. Parallel to WebSite.description above so both nodes in
        // the @graph paint the same picture. Without this Google's brand
        // panel was scraping page body text to summarise the entity.
        description:
          "Marketplace algérien d'annonces de téléphones, informatique, électroménager, mode et véhicules. Vendeurs algériens, prix en dinars (DZD). Conçu pour acheteurs humains et agents IA.",
        url: SITE_URL,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_URL}/icon.svg`,
        },
        // Structured customer-service contact. Google's knowledge-graph
        // brand panel renders contactPoint as a dedicated "Contact" row
        // when present — without it, the entity is reachable only via the
        // bare email field at the bottom of the node. contactType +
        // areaServed + availableLanguage are the three fields Google's
        // structured-data docs single out as ranking-relevant for the
        // commerce-panel "Contact" enrichment.
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer service",
          email: "mahlledz@gmail.com",
          areaServed: "DZ",
          availableLanguage: ["French", "Arabic", "English"],
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

  // Home-page FAQ — paired 1:1 with the FAQPage JSON-LD below. Distinct
  // questions from /about so the two FAQ pages don't shadow each other in
  // search/AI-panel surfaces. Home is the highest-PageRank surface on the
  // site, so the questions here target the highest-volume entry queries
  // ("is Teno Store legit / free", "how fresh is the catalog", "where do
  // sellers operate", "what payment methods"). 4 entries — well under
  // Google's 8-entry "spammy" threshold.
  const homeFaq: ReadonlyArray<{ q: string; a: string }> = [
    {
      q: "À quelle fréquence le catalogue de Teno Store est-il mis à jour ?",
      a: "Le catalogue est actualisé en continu — un scraper récupère les annonces fraîches des places de marché algériennes toutes les minutes et publie de nouveaux listings ainsi qu'un flux Atom (/feed.xml) en temps réel. Les annonces que vous parcourez à l'instant reflètent ce qui est réellement à vendre en Algérie aujourd'hui.",
    },
    {
      q: "Teno Store est-il gratuit pour les acheteurs et les vendeurs ?",
      a: "Oui, gratuit dans les deux sens : la navigation et la recherche sont libres, sans inscription ; les vendeurs peuvent publier leurs annonces sans frais via le tableau de bord vendeur en libre-service. Aucun frais de listing, aucun abonnement.",
    },
    {
      q: "Quels modes de paiement Teno Store accepte-t-il ?",
      a: "Le paiement se règle directement entre l'acheteur et le vendeur — Teno Store ne traite pas les paiements lui-même. La plupart des vendeurs algériens acceptent l'espèces à la livraison, le virement Edahabia/CCP, ou le paiement à la remise en main propre. Pour les achats délégués à un agent IA, l'authorization se fait via mandats AP2 avant que l'agent ne contacte le vendeur.",
    },
    {
      q: "Dans quelles villes algériennes les vendeurs de Teno Store sont-ils basés ?",
      a: "Les vendeurs sont répartis dans toute l'Algérie, avec des concentrations à Alger, Oran, Annaba, Constantine, Sétif et Blida. Chaque annonce indique la wilaya du vendeur et les wilayas couvertes par sa livraison — la plupart des vendeurs livrent dans toute l'Algérie via les services de colis nationaux.",
    },
  ];
  const homeFaqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}/#faq`,
    inLanguage: "fr",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": `${SITE_URL}/#organization` },
    // Speakable spans for AI voice/search panels — same pattern as /about.
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: ["#home-faq-heading", "#home-faq-heading ~ dl"],
    },
    mainEntity: homeFaq.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };

  // NOTE: previously had an explicit <link rel="preload" as="image"> for
  // the first product card's hero (iter-32). Reverted: Next.js already
  // auto-emits a preload for every <img fetchPriority="high">, and
  // ProductGrid renders the first 4 cards as eager+high. The explicit tag
  // was a duplicate of the auto-emitted one and could trigger Lighthouse
  // "preloaded resource not used" warnings via the
  // crossorigin="anonymous" mismatch (Next emits without it).
  return (
    <section className="relative">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(websiteJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(homeFaqJsonLd) }}
      />
      <div className="absolute inset-0 bg-grid opacity-50 pointer-events-none [mask-image:radial-gradient(closest-side,black,transparent)]" />
      {/* lang="en" wrapper: with <html lang="fr"> set at the layout level
          (previous iter), the hero block + agent cards are the only English
          content on the home page. Tagging them explicitly so screen
          readers switch voice/accent, language detectors don't penalise
          the document for mixed content without per-region hints, and
          Lighthouse's "Document has a content-language for non-default
          regions" audit passes. The bilingual catalog block below carries
          its own per-paragraph lang attributes. */}
      <div lang="en" className="relative pt-24 pb-16 text-center max-w-3xl mx-auto">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs text-accent bg-accent/10 border border-accent/30 mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" /> live
        </span>
        {/* Visual hero retains its existing size + gradient treatment so the
            English brand pitch stays prominent above the fold. Demoted from
            <h1> to a <p role="doc-subtitle">: Google heavily weights H1 for
            topic extraction, and an English brand-pitch H1 on a French-locale
            page (<html lang="fr">, French <meta description>, target queries
            "marketplace algérie" / "annonces algériens DZD") was telling
            crawlers this page is primarily about agent shopping rather than
            an Algerian marketplace. The actual H1 lives below as the catalog
            section heading. */}
        <p
          role="doc-subtitle"
          className="text-4xl sm:text-6xl font-semibold tracking-tight bg-gradient-to-b from-ink to-ink-soft bg-clip-text text-transparent"
        >
          Watch your agent shop, in real time.
        </p>
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
            lang="fr"
            className="inline-flex h-11 px-5 items-center rounded-xl bg-bg-soft border border-line text-ink-soft hover:border-accent/40 hover:text-ink transition"
          >
            Parcourir le catalogue
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
        {/* Promoted from <h2> to <h1>: now the page's only H1 element and the
            primary topic signal for crawlers. Matches the <html lang="fr">
            declaration and the French meta description. The English hero
            above stays visually prominent but ships as a <p role="doc-subtitle">
            — see the comment up there for the topic-signal rationale.
            Visual size bumped (text-2xl → text-3xl tracking-tight) so it
            reads as a real heading rather than a small section label. */}
        <h1 id="catalog-heading" lang="fr" className="text-3xl font-semibold tracking-tight mb-3">
          Marketplace algérien · annonces actualisées en temps réel
        </h1>
        <p lang="fr" className="text-ink-soft leading-relaxed mb-3">
          Découvrez des milliers d&rsquo;annonces de vendeurs algériens — téléphones,
          informatique, électroménager, mode, véhicules et plus. Prix en dinars (DZD),
          listings actualisés en continu depuis les principales places de marché du
          pays. Filtrez par marque, prix, vendeur ou catégorie pour trouver exactement
          ce que vous cherchez.
        </p>
        <p lang="en" className="text-sm text-ink-mute leading-relaxed">
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
            ["Immobilier", "immobilier"],
            ["Véhicules", "vehicules"],
          ].map(([label, slug]) => (
            <li key={slug}>
              <Link
                href={`/c/${encodeURIComponent(slug)}`}
                className="inline-flex items-center px-3 h-9 rounded-full bg-bg-soft border border-line-soft text-sm text-ink-soft hover:border-accent/40 hover:text-ink transition"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section lang="en" className="mt-16 max-w-4xl mx-auto" aria-labelledby="agent-heading">
        <h2 id="agent-heading" className="sr-only">How the agent observer works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          <Card title="Deep-linked searches" body="When your agent narrows a search, you get a URL that mirrors the same filters and results." />
          <Card title="Full product detail" body="Photos, variants, prices, attributes, and seller info — exactly what the agent saw." />
          <Card title="Trust signals" body="Stock state, verified seller information, and every listing scored on the same trust rubric." />
        </div>
      </section>
      {/* Home FAQ — visible HTML paired 1:1 with the FAQPage JSON-LD above.
          Google's FAQ rich-result guidelines require every Question's
          acceptedAnswer.text to appear in the rendered page body; mismatched
          structured/visible content triggers a manual action. Same source-
          of-truth array drives both surfaces (see homeFaq above). */}
      <section
        lang="fr"
        aria-labelledby="home-faq-heading"
        className="mt-16 max-w-3xl mx-auto"
      >
        <h2
          id="home-faq-heading"
          className="text-2xl font-semibold tracking-tight text-ink mb-4"
        >
          Questions fréquentes
        </h2>
        <dl className="space-y-5">
          {homeFaq.map(({ q, a }) => (
            <div key={q}>
              <dt className="text-base font-medium text-ink mb-1">{q}</dt>
              <dd className="leading-relaxed text-ink-soft">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
      {recent.length > 0 && (
        <section className="mt-12" aria-labelledby="recent-heading">
          <div className="flex items-baseline justify-between mb-4">
            <h2 id="recent-heading" className="text-xl font-semibold tracking-tight">Annonces récentes</h2>
            <Link href="/search" className="text-sm text-ink-soft hover:text-ink transition">Voir tout →</Link>
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
