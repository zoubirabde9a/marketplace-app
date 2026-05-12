import type { Metadata } from "next";
import Link from "next/link";
import { jsonLdString } from "@/lib/jsonld";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

export const metadata: Metadata = {
  // Layout template appends " · Teno Store" — bare "À propos" avoids the
  // "À propos · Teno Store" duplication this page used to render with the
  // earlier English-only "About" title.
  title: "À propos",
  description:
    "Teno Store — marketplace algérien avec des milliers d'annonces de téléphones, informatique, électroménager, mode et véhicules. Vendeurs algériens, prix en dinars (DZD). Conçu pour acheteurs humains et agents IA.",
  alternates: { canonical: "/about" },
  openGraph: {
    locale: "fr_DZ",
    alternateLocale: ["en_US"],
  },
};

export default function AboutPage() {
  const aboutJsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": `${SITE_URL}/about`,
    url: `${SITE_URL}/about`,
    name: "À propos de Teno Store",
    description:
      "À propos de Teno Store — marketplace algérien d'annonces de téléphones, informatique, électroménager, mode et véhicules. Vendeurs algériens, prix en dinars (DZD). Conçu pour acheteurs humains et agents IA (MCP, A2A, AP2) avec des signaux de confiance explicites sur chaque annonce.",
    // Page now ships a French primary intro followed by an English deep-dive
    // for the agent-developer audience. Tag both so Google's bilingual
    // handling treats the page consistently with the visible content.
    inLanguage: ["fr", "en"],
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": `${SITE_URL}/#organization` },
  };
  // Visible buyer FAQ — paired 1:1 with the FAQPage JSON-LD below. Google's
  // FAQ rich-result guidelines require every Question.acceptedAnswer.text to
  // appear in the rendered page body; mismatched structured/visible content
  // triggers a manual action. Keeping the source of truth in one array means
  // the visible <section> and the JSON-LD can never drift.
  //
  // Audience: French-speaking Algerian buyers + AI search engines
  // (ChatGPT/Perplexity/Bing Chat) that parse FAQPage to answer
  // "Qu'est-ce que Teno Store ?" / "Is Teno Store legit?" style queries
  // directly from the structured data. Six entries — Google's FAQ docs
  // warn that >8 entries per page can be flagged as spammy.
  const buyerFaq: ReadonlyArray<{ q: string; a: string }> = [
    {
      q: "Qu'est-ce que Teno Store ?",
      a: "Teno Store est un marketplace algérien avec des milliers d'annonces en direct — téléphones, informatique, électroménager, mode, véhicules et plus — issues de vrais vendeurs algériens. Les prix sont affichés en dinars algériens (DZD) et le catalogue est actualisé en continu.",
    },
    {
      q: "Comment acheter un produit sur Teno Store ?",
      a: "Parcourez le catalogue, ouvrez une annonce, puis contactez directement le vendeur via les boutons d'appel, WhatsApp ou Viber affichés sur la page produit. Vous pouvez aussi déléguer un budget d'achat à un agent IA qui négocie et achète pour vous via les protocoles MCP, A2A et AP2.",
    },
    {
      q: "Teno Store livre-t-il partout en Algérie ?",
      a: "La livraison dépend du vendeur. Chaque annonce indique les wilayas couvertes par le vendeur — la plupart livrent dans toute l'Algérie via les services de colis nationaux, certains se limitent à leur ville (Alger, Oran, Annaba, Constantine, Sétif, Blida).",
    },
    {
      q: "Comment savoir si un vendeur est fiable ?",
      a: "Chaque annonce affiche un indicateur de risque de contrefaçon visible, le nom du vendeur, ses coordonnées vérifiées (téléphone, WhatsApp, site web) et un lien vers sa boutique complète. Les annonces suspectes ou en cours de vérification sont clairement étiquetées dans l'interface et dans les données structurées.",
    },
    {
      q: "Puis-je vendre sur Teno Store ?",
      a: "Oui. Inscrivez-vous gratuitement comme vendeur, publiez vos annonces via le tableau de bord vendeur en libre-service, et atteignez à la fois les acheteurs humains et les agents IA. Les prix se fixent par variante en DZD, et chaque annonce est exposée simultanément en HTML, REST, MCP et A2A.",
    },
    {
      q: "Teno Store accepte-t-il les agents IA ?",
      a: "Oui — Teno Store est conçu nativement comme un marketplace agent-à-agent. Les agents IA peuvent découvrir, comparer et acheter via une API REST publique (api.teno-store.com/v1), un serveur Model Context Protocol (MCP) en streamable HTTP, et un serveur Agent-to-Agent (A2A) avec mandats AP2. La découverte se fait via /.well-known/agents.json.",
    },
  ];
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}/about#faq`,
    inLanguage: "fr",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    mainEntity: buyerFaq.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
  // BreadcrumbList helps Google show "Home > About" in SERP and reinforces
  // the page's depth in the site structure.
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "À propos", item: `${SITE_URL}/about` },
    ],
  };
  return (
    <article className="max-w-3xl mx-auto pt-12 pb-24 prose-invert text-ink-soft">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(aboutJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(faqJsonLd) }}
      />
      {/* French primary section. Page-level <html lang="fr"> at the layout
          level matches this block. Below the French intro, an
          <section lang="en"> wraps the English deep-dive for the
          agent-developer audience — same bilingual pattern the home page
          uses (iter-7), keeping the dominant SEO signals (title, H1, lede)
          in French while preserving the longer technical English copy. */}
      <section lang="fr">
        <h1 className="text-4xl font-semibold tracking-tight text-ink mb-3">
          À propos de Teno Store
        </h1>
        <p className="text-lg leading-relaxed">
          Teno Store est un <strong>marketplace algérien</strong> avec des
          milliers d&rsquo;annonces en direct — téléphones, informatique,
          électroménager, mode, véhicules et plus — issues de vrais vendeurs
          algériens à Alger, Oran, Annaba, Constantine, Sétif et d&rsquo;autres
          villes, avec des prix en dinars algériens (DZD). Le catalogue est
          actualisé en continu, donc les annonces que vous parcourez ici
          reflètent ce qui est réellement à vendre à l&rsquo;instant présent.
        </p>
        <p className="leading-relaxed mt-3">
          Techniquement, Teno Store est aussi un{" "}
          <strong>marketplace agent-à-agent</strong> : des agents IA peuvent
          découvrir, comparer et acheter des produits pour le compte
          d&rsquo;acheteurs humains via MCP, A2A et AP2. Le site que vous lisez
          est un miroir lisible humain de cette activité — vous pouvez regarder
          votre agent travailler en temps réel, ou parcourir le catalogue
          vous-même de la même manière qu&rsquo;un agent.
        </p>
        <h2 className="text-xl font-medium text-ink mt-10 mb-2">Pour les acheteurs</h2>
        <p className="leading-relaxed">
          Parcourez le catalogue librement, ou connectez-vous avec Google pour
          déléguer un budget d&rsquo;achat à un agent IA. Vous gardez le
          contrôle (révocation, journal d&rsquo;activité, signaux de confiance
          par annonce, snapshots horodatés de ce que l&rsquo;agent a vu).
        </p>
        <h2 className="text-xl font-medium text-ink mt-10 mb-2">Pour les vendeurs</h2>
        <p className="leading-relaxed">
          Publiez vos annonces sur Teno Store et atteignez à la fois les
          acheteurs humains et les agents IA. Tableau de bord vendeur en libre
          service, prix par variante en DZD, signaux anti-contrefaçon visibles
          sur chaque annonce.{" "}
          <Link href="/seller" className="text-accent hover:underline">
            S&rsquo;inscrire pour vendre →
          </Link>
        </p>
        <section aria-labelledby="faq-heading" className="mt-12">
          <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight text-ink mb-4">
            Questions fréquentes
          </h2>
          <dl className="space-y-5">
            {buyerFaq.map(({ q, a }) => (
              <div key={q}>
                <dt className="text-base font-medium text-ink mb-1">{q}</dt>
                <dd className="leading-relaxed text-ink-soft">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
        <h2 className="text-xl font-medium text-ink mt-10 mb-2">Commencer</h2>
        <p className="leading-relaxed">
          <Link href="/search" className="text-accent hover:underline">
            Parcourir le catalogue →
          </Link>
          {" · "}
          <Link href="/seller" className="text-accent hover:underline">
            Vendre sur Teno Store →
          </Link>
        </p>
      </section>

      <section lang="en" className="mt-16 pt-12 border-t border-line-soft">
        <h2 className="text-2xl font-semibold tracking-tight text-ink mb-3">
          For agents &amp; developers
        </h2>
        <p className="leading-relaxed">
          The rest of this page is in English — it&rsquo;s the agent /
          developer deep-dive on how Teno Store works as a machine-readable
          marketplace.
        </p>

      <h2 className="text-xl font-medium text-ink mt-10 mb-2">For buyers</h2>
      <p className="leading-relaxed">
        You don’t shop here directly. Your agent does — and you watch. Sign in
        with Google to mint an Agent Passport that delegates a bounded
        purchasing budget to an AI agent (yours or one provided by a third
        party). The agent can search the catalog, read product pages, and
        complete a purchase under the constraints you set. You can revoke the
        passport at any time, see the full activity log, and view the exact
        product detail the agent saw — including counterfeit-risk signals,
        seller information, and prices.
      </p>

      <h2 className="text-xl font-medium text-ink mt-10 mb-2">For sellers</h2>
      <p className="leading-relaxed">
        List your products on Teno Store and reach AI agents shopping on behalf
        of real buyers. Listings are exposed simultaneously over three
        machine-readable surfaces — a REST API at{" "}
        <code className="font-mono text-ink">api.teno-store.com/v1</code>, a
        Model Context Protocol (MCP) server, and an Agent-to-Agent (A2A)
        skill server — plus the human-readable HTML at{" "}
        <code className="font-mono text-ink">teno-store.com</code>. Pricing is
        per-variant in your own currency, stock and contact details are
        editable from the seller dashboard, and every listing carries a
        counterfeit-risk indicator alongside trusted sellers.{" "}
        <Link href="/seller" className="text-accent hover:underline">
          Sign up to sell →
        </Link>
      </p>

      <h2 className="text-xl font-medium text-ink mt-10 mb-2">For agents</h2>
      <p className="leading-relaxed">
        The canonical machine-readable surface is the API. Agents authenticate
        via OAuth 2.1 with PKCE and DPoP, mint a Passport JWT scoped to a
        principal, and call the catalog, cart, and checkout endpoints under
        that token. Capability discovery lives at{" "}
        <code className="font-mono text-ink">/.well-known/agents.json</code>{" "}
        on this host, with detailed protocol metadata for MCP, A2A, REST, and
        AP2 mandates. Public catalog reads (
        <code className="font-mono text-ink">GET /v1/products</code> and{" "}
        <code className="font-mono text-ink">GET /v1/products/{`{id}`}</code>)
        require no auth, so an agent can crawl the catalog before deciding
        whether to onboard.
      </p>

      <h2 className="text-xl font-medium text-ink mt-10 mb-2">Trust signals</h2>
      <ul className="list-none p-0 mt-2 space-y-3">
        <li className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          <span>
            <strong className="text-ink">Counterfeit-risk tiers</strong> are
            attached to every listing. Suppressed and under-review listings
            are clearly labelled both visually and in the structured data so
            agents can de-prioritize them.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          <span>
            <strong className="text-ink">Seller-supplied content</strong>{" "}
            (titles, descriptions, attributes) is rendered with an explicit
            untrusted-content marker so AI agents and humans don’t mistake it
            for system UI.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          <span>
            <strong className="text-ink">Public snapshot links</strong> at{" "}
            <code className="font-mono text-ink">/s/{`{id}`}</code> let humans
            re-view exactly what an agent saw at request time — frozen,
            read-only, expiring 24 hours after capture.
          </span>
        </li>
      </ul>

      <h2 className="text-xl font-medium text-ink mt-10 mb-2">Get started</h2>
      <p className="leading-relaxed">
        <Link href="/search" className="text-accent hover:underline">
          Browse the catalog →
        </Link>
        {" · "}
        <Link href="/seller" className="text-accent hover:underline">
          Sell on Teno Store →
        </Link>
      </p>
      </section>
    </article>
  );
}
