import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { Header } from "@/components/Header";
import { CategoryFooter } from "@/components/CategoryFooter";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    // Homepage title (the blue link in Google SERP). Previously led with
    // "the agent-to-agent marketplace" — an English dev-pitch H1 on a
    // <html lang="fr"> page targeting French Algerian buyer queries
    // ("marketplace algérien", "annonces algérie", "téléphones DZD").
    // Title-tag mismatch with the rendered French H1 and meta description
    // told Google the page topic was developer/agent tooling, not an
    // Algerian consumer marketplace. Catalog-first wording aligns with
    // the H1, meta description, and Organization JSON-LD slogan. The
    // agent-marketplace angle stays on og:title (social previews) and
    // keywords so the API/agent audience still lands.
    default: "Teno Store — Marketplace algérien : téléphones, électroménager, mode et véhicules en DZD",
    template: "%s · Teno Store",
  },
  // Trimmed to ~155 chars for Google SERP — earlier 307-char version got
  // mid-sentence truncated. Catalog signal (geography, currency, breadth)
  // stays in the lede; the agent-marketplace angle moved to keywords +
  // og:description (which Facebook/Discord/Slack render with no length
  // budget).
  description:
    "Marketplace algérien — milliers d'annonces de téléphones, informatique, électroménager, mode et véhicules. Vendeurs algériens, prix en dinars (DZD).",
  applicationName: "Teno Store",
  // Google ignores <meta name="keywords">, but Yandex still reads it and so
  // do some Algerian-locale regional engines + a few internal site-search
  // tools. Mix the catalog topical terms (English + French) with the
  // agent-marketplace angle so both audiences land.
  keywords: [
    // Catalog (highest CTR/relevance for actual buyers)
    "marketplace algérien",
    "annonces algérie",
    "téléphones algérie",
    "smartphones DZD",
    "ordinateurs portables algérie",
    "électroménager algérie",
    "vente Algérie",
    "Algerian marketplace",
    "Algeria phones",
    "DZD listings",
    // Agent-marketplace angle
    "agent-to-agent marketplace",
    "AI agent shopping",
    "MCP marketplace",
    "A2A protocol",
    "AP2 mandates",
    "agentic commerce",
    // Brand
    "Teno Store",
  ],
  openGraph: {
    siteName: "Teno Store",
    title: "Teno Store — the agent-to-agent marketplace",
    description:
      "Marketplace algérien — milliers d'annonces de téléphones, informatique, électroménager, mode et véhicules. Vendeurs algériens, prix en dinars (DZD). Conçu pour acheteurs humains et agents IA (MCP, A2A, AP2).",
    type: "website",
    url: SITE_URL,
    // Primary content language is French (every product title, description,
    // category label and slice intro comes from Algerian Ouedkniss listings
    // in French; Arabic is the secondary regional language, English is only
    // the homepage hero copy). Mis-stating locale as en_US was telling
    // Facebook/LinkedIn/etc. share previews to render English-locale
    // formatting on French catalog content, and giving Open Graph crawlers
    // a wrong language signal.
    locale: "fr_DZ",
    alternateLocale: ["ar_DZ", "en_US"],
    // Default share image used when a page (homepage, /search, /seller, /about)
    // doesn't supply its own og:image. apple-icon is generated at 180x180; the
    // ImageResponse renderer paints the brand mark on a green gradient.
    images: [{ url: "/apple-icon", width: 180, height: 180, alt: "Teno Store" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Teno Store — the agent-to-agent marketplace",
    description: "Marketplace algérien · annonces de vendeurs algériens en DZD · conçu pour acheteurs humains et agents IA.",
    // Intentionally omit `images` so Next's file-based opengraph-image.tsx
    // convention also fills twitter:image. Previously hard-coded to
    // /apple-icon (180×180), which fails Twitter's summary_large_image
    // requirement (≥1200×675) and produced a tiny corner-of-card preview
    // on every X/Twitter share.
  },
  alternates: {
    canonical: SITE_URL,
    // hreflang annotations. Site is single-language (fr-DZ) — declaring it
    // explicitly tells Google/Yandex/Bing the target audience for SERP
    // language filters ("pages in French") and country targeting. The
    // x-default fallback covers users whose accept-language doesn't match
    // fr-* (Google routes them here rather than guessing). Self-referential
    // canonical is fine for a single-locale site; the value point is having
    // the tag at all, not having multiple translations. See og:locale and
    // <html lang="fr"> in body.tsx for the matching signals.
    languages: {
      "fr-DZ": SITE_URL,
      // Algeria is officially bilingual French + Arabic. The catalog content
      // itself is predominantly French (every product title/description), but
      // Algerian buyer queries are frequently Arabic ("هواتف الجزائر",
      // "كمبيوتر محمول الجزائر"). Declaring ar-DZ as an alternate that
      // resolves to the same URL is the schema.org-blessed way to tell
      // search/AI engines "this page also serves Arabic-speaking Algerian
      // users" without requiring a translated build. Google AI Overviews and
      // Bing Chat both honor hreflang when ranking sources for queries in
      // the targeted language.
      "ar-DZ": SITE_URL,
      "x-default": SITE_URL,
    },
    // Atom feed alternate link is rendered inline in the <head> below
    // instead of here — when child pages (/search, /product) override
    // their own alternates.types, Next.js replaces the layout-level
    // types entirely, dropping feed discovery on the deepest indexed
    // surfaces (where AI crawlers most often land from Google).
  },
  // Google honors max-image-preview / max-snippet / max-video-preview as
  // hints for how much of the page it may display in SERP. Default image
  // preview size is "standard" (small thumb); "large" enables full-width
  // images on mobile and Image Search rich results — meaningful mobile
  // CTR lift on visual catalogs like ours. max-snippet:-1 lets Google
  // pick a snippet of any length (it won't pad beyond useful, but it
  // also won't artificially clip mid-sentence). max-video-preview:-1
  // is harmless on a non-video site but future-proofs.
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
  },
  // Prevent iOS Safari and Chrome from auto-detecting numeric text (DZD
  // prices, productIds, dates) and turning them into tel:/email/address
  // links. The product page emits explicit <a href="tel:..."> chips for
  // real seller phone numbers, so opt out of the heuristic everywhere.
  formatDetection: { telephone: false, email: false, address: false },
  // Region targeting. The catalog is Algerian — phones, electronics, fashion,
  // home appliances priced in DZD by sellers in Algiers, Oran, Annaba, etc.
  // - geo.region uses ISO 3166-2 (DZ-16 = Algiers province; coarse but
  //   sufficient for a national marketplace).
  // - geo.placename / geo.position / ICBM mirror the same signal in formats
  //   Yandex, Bing, and various regional engines have historically read.
  // - og:country-name carries the same fact in the Open Graph namespace.
  // These are supplemental hints; they don't replace the structured-data /
  // sitemap signals, but cost ~200 bytes per page and feed engines that
  // don't yet read every JSON-LD field.
  // NOTE: og:country-name is NOT here — Next's metadata.other emits
  // <meta name="..."> and the OG spec requires property=. Rendered inline
  // in the layout body below so React 19 hoists it as <meta property=>.
  other: {
    "geo.region": "DZ",
    "geo.placename": "Algeria",
    "geo.position": "28.0339;1.6596",
    "ICBM": "28.0339, 1.6596",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="dark">
      <head>
        {/* Hero images live on Ouedkniss CDN (cdn7/cdn8/cdn9.ouedkniss.com).
            Preconnect lets the browser run TLS + TCP handshakes in parallel
            with the HTML parse, so by the time the <img> hits the network
            the connection is warm — measurable LCP win on product pages
            where the hero is the largest contentful paint element.
            dns-prefetch on the bare host catches any CDN we missed. */}
        <link rel="preconnect" href="https://cdn7.ouedkniss.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://cdn8.ouedkniss.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://cdn9.ouedkniss.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://ouedkniss.com" />
        {/* OG country tag — must use property= per OG spec; Next.js
            metadata.other emits name= so this is rendered inline. */}
        <meta property="og:country-name" content="Algeria" />
        {/* Atom feed auto-discovery. Declared inline (not via Next's
            metadata.alternates.types) because pages with their own
            alternates — /search, /product/[id] — replace the entire
            types map and lose feed discovery. Render here so RSS-aware
            AI crawlers (ChatGPT, Perplexity, Claude search) find the
            feed regardless of which page they enter the site through. */}
        <link
          rel="alternate"
          type="application/atom+xml"
          title="Teno Store — Annonces récentes"
          href="/feed.xml"
        />
        {/* LLM-discovery hints. The `llms.txt` / `llms-full.txt` convention
            (https://llmstxt.org/) ships the site as a plain-text bundle an
            LLM can ingest in one fetch — short summary + long-form reference.
            Declaring them as <link rel="alternate"> in every page's head
            means HTML-walking crawlers (ChatGPT search, Perplexity, Bing
            Chat, Google AI Overviews) discover them through standard HTML
            parsing instead of having to guess at the URL or only finding
            them via the well-known path probe. Same discovery mechanism
            already used for feed.xml above. */}
        <link
          rel="alternate"
          type="text/plain; charset=utf-8"
          title="Teno Store — LLM site summary"
          href="/llms.txt"
        />
        <link
          rel="alternate"
          type="text/plain; charset=utf-8"
          title="Teno Store — LLM site reference (long-form)"
          href="/llms-full.txt"
        />
      </head>
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-accent focus:text-bg focus:shadow-glow focus:outline-none"
        >
          Aller au contenu principal
        </a>
        <Header />
        {/* CategoryFooter relocated above main because infinite scrolling
            on /search and / makes the page bottom effectively unreachable
            — users (and crawlers walking via scroll) can't get to the
            categories/brands/sellers chips when they live in the footer.
            Rendered as a collapsed <details> disclosure so the chips are
            one click away on every page without dominating the viewport.
            Awaited inline (no Suspense) — see git history of layout.tsx
            for the byte-position-ordering rationale. */}
        <CategoryFooter />
        <main id="main" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-24">{children}</main>
        <footer className="border-t border-line-soft mt-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 text-sm text-ink-mute flex flex-col sm:flex-row items-center justify-between gap-3">
            <nav aria-label="Pied de page" className="flex items-center gap-5">
              <Link href="/search" className="hover:text-ink transition">Parcourir</Link>
              <Link href="/seller/products/new" className="hover:text-ink transition">Vendre</Link>
              <Link href="/blog" className="hover:text-ink transition">Blog</Link>
              <Link href="/about" className="hover:text-ink transition">À propos</Link>
            </nav>
            <span>© {new Date().getFullYear()} Teno Store</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
