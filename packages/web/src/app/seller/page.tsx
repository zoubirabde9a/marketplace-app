import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/sellerSession";
import { jsonLdString } from "@/lib/jsonld";
import { GoogleSignInButton } from "./GoogleSignInButton";

export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

export const metadata: Metadata = {
  // Layout template adds " · Teno Store" — bare "Vendre" avoids the brand-
  // doubled "Vendre sur Teno Store · Teno Store" rendering. Switched from
  // English "Sell" to French "Vendre" so the title aligns with the page's
  // <html lang="fr"> declaration; mirrors the iter-12 /about French-ification.
  title: "Vendre",
  description:
    "Publiez vos annonces sur Teno Store et atteignez à la fois les acheteurs algériens et les agents IA. Connectez-vous avec Google pour créer votre profil vendeur.",
  alternates: {
    canonical: "/seller",
    // Re-declare hreflang — Next.js replaces layout-level alternates
    // wholesale on child pages.
    languages: {
      "fr-DZ": `${SITE_URL}/seller`,
      // Match the layout-level ar-DZ hreflang declaration. See layout.tsx.
      "ar-DZ": `${SITE_URL}/seller`,
      "x-default": `${SITE_URL}/seller`,
    },
  },
  openGraph: {
    // See /about/page.tsx for the wholesale-replace rationale.
    siteName: "Teno Store",
    type: "website",
    url: `${SITE_URL}/seller`,
    locale: "fr_DZ",
    alternateLocale: ["en_US", "ar_DZ"],
  },
};

export default async function SellerLandingPage() {
  const session = await getCurrentUser();
  if (session) redirect("/seller/dashboard");

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

  const sellerJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE_URL}/seller`,
    url: `${SITE_URL}/seller`,
    name: "Vendre sur Teno Store",
    description:
      "Vendez sur Teno Store, marketplace algérien agent-first. Connectez-vous avec Google pour créer votre profil vendeur, publier des annonces, et laisser les agents IA découvrir et acheter votre inventaire via MCP, A2A et AP2.",
    // Page is now French-primary (title, H1, lede, CTA) with a small English
    // dev-audience note kept inside a lang="en" span. Tag both so the
    // bilingual signal lines up with the visible content.
    inLanguage: ["fr", "en"],
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": `${SITE_URL}/#organization` },
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Vendre", item: `${SITE_URL}/seller` },
    ],
  };
  // Service schema for the seller-onboarding offering. The audit on
  // 2026-05-16 (deploy/CHANGELOG.md) flagged /seller as the only page
  // with sparse structured data — just WebPage + BreadcrumbList. That
  // was appropriate for a marketing landing but undersold what the page
  // actually offers: a free, machine-discoverable, geo-scoped commerce
  // service. Service + Offer + areaServed + audience is the schema.org
  // shape Google + AI panels look for when ranking sources for
  // "comment vendre en ligne en Algérie / how to sell online in Algeria"
  // queries — exactly the entry-query class for /seller.
  const sellerServiceJsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${SITE_URL}/seller#service`,
    name: "Vendre sur Teno Store — compte vendeur",
    serviceType: "Marketplace seller account",
    description:
      "Compte vendeur gratuit sur Teno Store, marketplace algérien. Publiez vos annonces de téléphones, informatique, électroménager, mode et autres produits ; recevez des commandes directement (nom, téléphone, wilaya) ; et soyez automatiquement exposé aux agents IA qui achètent via MCP, A2A et AP2.",
    provider: { "@id": `${SITE_URL}/#organization` },
    areaServed: { "@type": "Country", name: "Algeria" },
    availableChannel: {
      "@type": "ServiceChannel",
      serviceUrl: `${SITE_URL}/seller`,
      availableLanguage: ["fr", "ar", "en"],
    },
    audience: {
      "@type": "BusinessAudience",
      name: "Vendeurs algériens",
      audienceType: "Sellers based in Algeria",
      geographicArea: { "@type": "Country", name: "Algeria" },
    },
    // Offers block declares "free to use" — the exact signal AI panels
    // look for when answering "is X free to sell on" queries. priceCurrency
    // is required by schema.org even when price is 0.
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "DZD",
      eligibleRegion: { "@type": "Country", name: "Algeria" },
      availability: "https://schema.org/InStock",
      description: "Gratuit — aucun frais d'inscription ni de listing.",
    },
    termsOfService: `${SITE_URL}/about`,
    isPartOf: { "@id": `${SITE_URL}/#website` },
  };

  return (
    <section className="max-w-xl mx-auto pt-8 sm:pt-16 pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(sellerJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(sellerServiceJsonLd) }}
      />
      <div className="rounded-2xl border border-line-soft bg-bg-soft/60 p-5 sm:p-8 backdrop-blur">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Vendre sur Teno Store</h1>
        <p className="mt-3 text-ink-soft leading-relaxed">
          Connectez-vous avec Google pour gérer votre profil vendeur, publier
          vos annonces et mettre à jour vos coordonnées.
        </p>
        {clientId ? (
          <div className="mt-6">
            <GoogleSignInButton clientId={clientId} />
            <noscript>
              <p className="mt-3 text-sm text-warn">
                La connexion nécessite JavaScript. Activez JavaScript ou
                contactez-nous à
                <a href="mailto:mahlledz@gmail.com" className="text-accent hover:underline active:underline ml-1">
                  mahlledz@gmail.com
                </a>{" "}
                pour vous inscrire manuellement.
              </p>
            </noscript>
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn" lang="en">
            Google sign-in is not configured. Set{" "}
            <code className="font-mono">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> in
            the web app environment to enable login.
          </div>
        )}
      </div>
      <ul className="mt-8 space-y-3 text-sm text-ink-soft list-none p-0">
        <li className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          <span>
            Acheteurs algériens et assistants IA voient vos annonces — sans
            paramétrage technique de votre côté.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          <span>
            Publication en quelques secondes : titre, prix en dinars, c’est
            tout.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          <span>
            Vous recevez les commandes avec nom, téléphone et région —
            contactez le client directement.
          </span>
        </li>
      </ul>
    </section>
  );
}
