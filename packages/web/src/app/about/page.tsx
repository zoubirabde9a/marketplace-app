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
    "Teno Store — marketplace algérien avec des milliers d'annonces de téléphones, informatique, électroménager, mode et véhicules. Vendeurs algériens, prix en dinars (DZD), catalogue actualisé en continu.",
  alternates: {
    canonical: "/about",
    // Re-declare hreflang so Next's wholesale replacement of layout-level
    // alternates doesn't drop the fr-DZ / x-default signal on this page.
    languages: {
      "fr-DZ": `${SITE_URL}/about`,
      // Match the layout-level ar-DZ hreflang declaration. See layout.tsx
      // for the rationale.
      "ar-DZ": `${SITE_URL}/about`,
      "x-default": `${SITE_URL}/about`,
    },
  },
  openGraph: {
    // Next.js wholesale-replaces openGraph on child pages (no shallow-merge),
    // so re-declare the fields the layout would otherwise supply: siteName,
    // type, url. Without these the social/AI preview card loses the
    // "Teno Store" publisher chrome, the type category, and the canonical
    // URL — defaults to a bare-domain preview.
    siteName: "Teno Store",
    type: "website",
    url: `${SITE_URL}/about`,
    locale: "fr_DZ",
    alternateLocale: ["ar_DZ"],
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
      "À propos de Teno Store — marketplace algérien d'annonces de téléphones, informatique, électroménager, mode et véhicules. Vendeurs algériens, prix en dinars (DZD) avec des signaux de confiance explicites sur chaque annonce.",
    // Page is single-language French now (the prior English deep-dive
    // section was removed). Match the visible content with a single-locale
    // inLanguage tag.
    inLanguage: ["fr"],
    // dateModified gives AI crawlers (Perplexity, ChatGPT search, Google AI
    // Overviews) an explicit freshness signal — pages with recent
    // dateModified are weighted higher in source ranking for time-sensitive
    // queries. Compile-time date is fine here: the about page content is
    // updated whenever the codebase rebuilds and redeploys, so the build
    // timestamp is a tight upper bound on actual last-modification.
    dateModified: new Date().toISOString().split("T")[0],
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
      a: "Parcourez le catalogue, ouvrez une annonce, puis contactez directement le vendeur via les boutons d'appel, WhatsApp ou Viber affichés sur la page produit. L'échange et le paiement se font ensuite hors plateforme, comme sur les autres places de marché algériennes.",
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
      a: "Oui. Inscrivez-vous gratuitement comme vendeur, publiez vos annonces via le tableau de bord vendeur en libre-service, et touchez les acheteurs algériens. Les prix se fixent par variante en DZD, et la mise en ligne ne demande aucun frais.",
    },
    // 7th entry — still under Google's 8-FAQ-entry "spammy" threshold.
    // Comparison queries ("Teno Store vs Ouedkniss / vs Jumia") are
    // exactly what users send to ChatGPT/Gemini when evaluating Algerian
    // marketplaces. Capturing the answer in FAQPage JSON-LD lets AI
    // search panels quote it verbatim instead of synthesising from
    // unrelated sources.
    {
      q: "Quelle est la différence entre Teno Store et Ouedkniss ou Jumia Algérie ?",
      a: "Ouedkniss est une plateforme de petites annonces où l'échange se fait entièrement hors plateforme entre l'acheteur et le vendeur. Jumia Algérie est un détaillant intégré verticalement avec sa propre logistique et son propre stock. Teno Store est un marketplace de vendeurs tiers : les annonces, les prix et les coordonnées viennent directement de vendeurs algériens, et les acheteurs les contactent en direct. Le catalogue couvre les mêmes catégories que les autres places de marché du pays, avec une interface plus rapide et un signal de confiance par annonce.",
    },
  ];
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}/about#faq`,
    inLanguage: "fr",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    // Speakable annotation: tells Google Assistant + AI search engines
    // (Bing Chat / ChatGPT search / Perplexity voice mode) which spans on
    // the page are suitable to be read aloud as featured snippets. The
    // CSS selector targets the FAQ <section> + the brand definition sentence
    // — exactly the content an AI search panel needs to answer "what is
    // Teno Store / is Teno Store legit / how do I buy" without reading
    // the whole page. Speakable is the schema.org-blessed mechanism Google
    // documented for voice/AI snippet eligibility; pure additive markup,
    // ignored by engines that don't use it.
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: ["#faq-heading", "#faq-heading ~ dl"],
    },
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
    <article className="max-w-3xl mx-auto pt-6 sm:pt-12 pb-12 sm:pb-24 prose-invert text-ink-soft">
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
        <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight text-ink mb-3 break-words">
          À propos de Teno Store
        </h1>
        <p className="text-base sm:text-lg leading-relaxed">
          Teno Store est un <strong>marketplace algérien</strong> avec des
          milliers d&rsquo;annonces en direct — téléphones, informatique,
          électroménager, mode, véhicules et plus — issues de vrais vendeurs
          algériens à Alger, Oran, Annaba, Constantine, Sétif et d&rsquo;autres
          villes, avec des prix en dinars algériens (DZD). Le catalogue est
          actualisé en continu, donc les annonces que vous parcourez ici
          reflètent ce qui est réellement à vendre à l&rsquo;instant présent.
        </p>
        <h2 className="text-xl font-medium text-ink mt-10 mb-2">Pour les acheteurs</h2>
        <p className="leading-relaxed">
          Parcourez le catalogue librement, sans inscription. Connectez-vous
          avec Google pour enregistrer vos favoris, suivre vos recherches et
          accéder à un historique de ce que vous avez consulté. Les signaux
          de confiance (statut du vendeur, indicateur de contrefaçon, stock)
          sont visibles sur chaque annonce.
        </p>
        <h2 className="text-xl font-medium text-ink mt-10 mb-2">Pour les vendeurs</h2>
        <p className="leading-relaxed">
          Publiez vos annonces sur Teno Store et touchez les acheteurs
          algériens. Tableau de bord vendeur en libre-service, prix par
          variante en DZD, signaux anti-contrefaçon visibles sur chaque
          annonce, aucun frais de listing.{" "}
          <Link href="/seller" className="text-accent hover:underline active:underline">
            S&rsquo;inscrire pour vendre →
          </Link>
        </p>
        {/* Editorial cluster reference. iter-86: AI panels landing on /about
            don't otherwise discover the 13-post buying-guide cluster, so
            surface it here with a short categorised hub. Same internal-linking
            principle the individual blog posts already use at their bottom. */}
        <h2 className="text-xl font-medium text-ink mt-10 mb-2">Guides d&rsquo;achat et de vente</h2>
        <p className="leading-relaxed">
          Le{" "}
          <Link href="/blog" className="text-accent hover:underline active:underline">
            blog Teno Store
          </Link>{" "}
          rassemble des guides pratiques sur le commerce algérien en ligne :
        </p>
        <ul className="mt-3 space-y-2 text-ink-soft leading-relaxed list-none p-0">
          <li>
            <strong>Guides d&rsquo;achat par catégorie</strong> —{" "}
            <Link href="/blog/guide-achat-smartphone-occasion-algerie-2026" className="text-accent hover:underline active:underline">smartphone d&rsquo;occasion</Link>,{" "}
            <Link href="/blog/ordinateur-portable-etudes-algerie-guide-2026" className="text-accent hover:underline active:underline">ordinateur portable</Link>,{" "}
            <Link href="/blog/guide-achat-televiseur-algerie-2026" className="text-accent hover:underline active:underline">téléviseur</Link>,{" "}
            <Link href="/blog/guide-achat-climatiseur-algerie-2026" className="text-accent hover:underline active:underline">climatiseur</Link>,{" "}
            <Link href="/blog/guide-achat-refrigerateur-algerie-2026" className="text-accent hover:underline active:underline">réfrigérateur</Link>,{" "}
            <Link href="/blog/guide-achat-lave-linge-algerie-2026" className="text-accent hover:underline active:underline">lave-linge</Link>,{" "}
            <Link href="/blog/guide-achat-electromenager-algerie-2026" className="text-accent hover:underline active:underline">électroménager général</Link>,{" "}
            <Link href="/blog/machine-a-cafe-algerie-guide-achat-2026" className="text-accent hover:underline active:underline">machine à café</Link>,{" "}
            <Link href="/blog/guide-mode-vetements-marques-algerie-2026" className="text-accent hover:underline active:underline">mode et vêtements de marque</Link>,{" "}
            <Link href="/blog/acheter-voiture-occasion-algerie-10-verifications" className="text-accent hover:underline active:underline">véhicule d&rsquo;occasion</Link>.
          </li>
          <li>
            <strong>Acheter en confiance</strong> —{" "}
            <Link href="/blog/acheter-en-ligne-algerie-sans-se-faire-avoir-2026" className="text-accent hover:underline active:underline">éviter les arnaques</Link>,{" "}
            <Link href="/blog/payer-en-ligne-algerie-methodes-paiement-2026" className="text-accent hover:underline active:underline">méthodes de paiement (Edahabia, CIB, CCP)</Link>,{" "}
            <Link href="/blog/livraison-algerie-services-colis-tarifs-2026" className="text-accent hover:underline active:underline">services de livraison (Yalidine, ZR Express, DHL)</Link>.
          </li>
          <li>
            <strong>Vendre en ligne</strong> —{" "}
            <Link href="/blog/vendre-en-ligne-algerie-guide-complet-demarrer-2026" className="text-accent hover:underline active:underline">guide complet pour démarrer</Link>,{" "}
            <Link href="/blog/vendre-sur-teno-store-7-conseils-annonces" className="text-accent hover:underline active:underline">7 conseils pour des annonces qui marchent</Link>.
          </li>
        </ul>
        <section aria-labelledby="faq-heading" className="mt-8 sm:mt-12">
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
        <h2 id="comparaison" className="text-lg sm:text-xl font-medium text-ink mt-10 mb-2 break-words">
          Comparaison avec les autres marketplaces algériens
        </h2>
        <p className="leading-relaxed">
          Les utilisateurs algériens combinent souvent plusieurs marketplaces selon
          le besoin. Voici comment Teno Store se positionne :
        </p>
        <ul className="list-none p-0 mt-2 space-y-3">
          <li className="flex items-start gap-3">
            <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
            <span>
              <strong className="text-ink">Ouedkniss</strong> est une plateforme
              de petites annonces : les transactions et la confiance se gèrent
              entièrement hors plateforme entre l&rsquo;acheteur et le vendeur.
              Teno Store reprend une partie du même catalogue dans une
              interface plus rapide, avec des signaux de confiance par
              annonce (stock, indicateur de contrefaçon, profil vendeur).
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
            <span>
              <strong className="text-ink">Jumia Algérie</strong> est un
              détaillant intégré verticalement, avec son propre stock et sa
              propre logistique. Teno Store est un marketplace de vendeurs
              tiers : les annonces, les prix et les coordonnées de contact
              viennent directement des vendeurs algériens, sans intermédiaire.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
            <span>
              {/* Per-category listing counts. Auto-refresher handles the
                  three machine-readable manifests (agents.json, llms.txt,
                  llms-full.txt) hourly, but this visible HTML stays manual
                  — regex-editing TSX from a Python script is too brittle.
                  Refresh manually when any category crosses a thousand
                  boundary: pull current counts from agents.json
                  `top_categories[].listings` and round to the nearest 100.
                  Last refreshed 2026-05-16 (catalog ~48,950, scraper
                  +~350/hr) — drift is slow (Informatique grows by
                  ~5% per week relative to the displayed value). */}
              <strong className="text-ink">Catalogue commun</strong> avec les
              grandes catégories du commerce algérien — informatique
              (~19 700 annonces, la plus grande catégorie), électroménager
              (~9 400), téléphones (~8 700), immobilier (~5 900) et mode
              (~4 900) — issues de vendeurs algériens, prix en dinars (DZD).
            </span>
          </li>
        </ul>

        <h2 className="text-xl font-medium text-ink mt-10 mb-2">Commencer</h2>
        <p className="leading-relaxed">
          <Link href="/search" className="text-accent hover:underline active:underline">
            Parcourir le catalogue →
          </Link>
          {" · "}
          <Link href="/seller" className="text-accent hover:underline active:underline">
            Vendre sur Teno Store →
          </Link>
        </p>
      </section>

    </article>
  );
}
