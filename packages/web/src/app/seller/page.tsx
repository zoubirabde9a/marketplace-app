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
      "x-default": `${SITE_URL}/seller`,
    },
  },
  openGraph: {
    locale: "fr_DZ",
    alternateLocale: ["en_US"],
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

  return (
    <section className="max-w-xl mx-auto pt-16 pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(sellerJsonLd) }}
      />
      <div className="rounded-2xl border border-line-soft bg-bg-soft/60 p-8 backdrop-blur">
        <h1 className="text-3xl font-semibold tracking-tight">Vendre sur Teno Store</h1>
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
                <a href="mailto:mahlledz@gmail.com" className="text-accent hover:underline ml-1">
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
