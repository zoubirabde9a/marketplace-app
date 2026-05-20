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
    "Publiez vos annonces sur Teno Store et touchez les acheteurs algériens. Connectez-vous avec Google pour créer votre profil vendeur, gratuitement et en quelques minutes.",
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
      "Vendez sur Teno Store, marketplace algérien. Connectez-vous avec Google pour créer votre profil vendeur, publier des annonces de téléphones, informatique, électroménager, mode ou véhicules en dinars (DZD), et toucher les acheteurs algériens — sans frais d'inscription ni de listing.",
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
      "Compte vendeur gratuit sur Teno Store, marketplace algérien. Publiez vos annonces de téléphones, informatique, électroménager, mode et autres produits ; recevez des commandes directement (nom, téléphone, wilaya) ; tableau de bord en libre-service, prix par variante en DZD.",
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
    <section aria-labelledby="seller-landing-heading" className="max-w-xl mx-auto pt-8 sm:pt-16 pb-12 sm:pb-24">
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
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <h1 id="seller-landing-heading" className="text-2xl sm:text-3xl font-semibold tracking-tight">Vendre sur Teno Store</h1>
          {/* "Gratuit" chip — the most important upfront fact, already
              declared in the Service JSON-LD but invisible to humans
              before this. Sellers comparing platforms decide on price
              first; surface it. */}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-ok/40 bg-ok/10 text-xs font-medium text-ok">
            <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-ok" />
            Gratuit · sans commission
          </span>
        </div>
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
                <a
                  href={`mailto:mahlledz@gmail.com?subject=${encodeURIComponent("Inscription vendeur manuelle")}&body=${encodeURIComponent(
                    "Bonjour,\n\nJe souhaite créer un compte vendeur manuellement. Voici mes informations :\n\n• Nom de la boutique :\n• Téléphone :\n• Wilaya :\n\nMerci.",
                  )}`}
                  className="text-accent hover:underline active:underline ml-1"
                >
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
            Vos annonces sont visibles par les acheteurs algériens dès la
            publication — aucun paramétrage technique requis.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          <span>
            Publication en quelques secondes : une image, un titre, un prix en
            dinars, c’est tout.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          <span>
            Vous recevez les commandes avec nom, téléphone et wilaya —
            contactez le client en un tap, par appel ou WhatsApp.
          </span>
        </li>
      </ul>
    </section>
  );
}
