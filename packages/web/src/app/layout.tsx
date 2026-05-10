import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import { Header } from "@/components/Header";
import { CategoryFooter } from "@/components/CategoryFooter";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Teno Store — the agent-to-agent marketplace",
    template: "%s · Teno Store",
  },
  // Description balances the agentic-commerce story with the topical content
  // a search engine actually needs to rank us for. The opening sentence carries
  // the catalog signal (geography, categories, French-language hint) so a
  // model or crawler sampling only the lede still learns what's for sale; the
  // tail keeps the agent / MCP / A2A / AP2 angle for the audience that came
  // looking for that explicitly.
  description:
    "Browse thousands of live listings — phones, computing, home appliances, fashion and vehicles — sourced from Algerian sellers and priced in DZD. Teno Store is also an API-first agent marketplace: discovery, search, and offers are exposed via MCP, A2A and AP2 so AI agents can shop for their human principals.",
  applicationName: "Teno Store",
  keywords: [
    "agent-to-agent marketplace",
    "AI agent shopping",
    "MCP marketplace",
    "A2A protocol",
    "AP2 mandates",
    "agentic commerce",
    "Teno Store",
  ],
  openGraph: {
    siteName: "Teno Store",
    title: "Teno Store — the agent-to-agent marketplace",
    description:
      "Watch your AI agent discover, compare and transact for products in real time. Built on MCP, A2A and AP2.",
    type: "website",
    url: SITE_URL,
    locale: "en_US",
    // Default share image used when a page (homepage, /search, /seller, /about)
    // doesn't supply its own og:image. apple-icon is generated at 180x180; the
    // ImageResponse renderer paints the brand mark on a green gradient.
    images: [{ url: "/apple-icon", width: 180, height: 180, alt: "Teno Store" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Teno Store — the agent-to-agent marketplace",
    description: "AI agents shop here. Watch them work.",
    // Intentionally omit `images` so Next's file-based opengraph-image.tsx
    // convention also fills twitter:image. Previously hard-coded to
    // /apple-icon (180×180), which fails Twitter's summary_large_image
    // requirement (≥1200×675) and produced a tiny corner-of-card preview
    // on every X/Twitter share.
  },
  alternates: { canonical: SITE_URL },
  robots: { index: true, follow: true },
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
  other: {
    "geo.region": "DZ",
    "geo.placename": "Algeria",
    "geo.position": "28.0339;1.6596",
    "ICBM": "28.0339, 1.6596",
    "og:country-name": "Algeria",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-accent focus:text-bg focus:shadow-glow focus:outline-none"
        >
          Skip to main content
        </a>
        <Header />
        <main id="main" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-24">{children}</main>
        <footer className="border-t border-line-soft mt-16">
          {/* CategoryFooter is async (fetches /v1/products?limit=1 facets).
              Without an explicit Suspense, Next 15 makes it an implicit
              streaming boundary AND lets it race the page-level main fetch.
              Since the footer fetch is data-cached (revalidate 600s) it
              resolves first and streams ahead of the page's H1 + product
              list — which trashes source order for non-JS crawlers reading
              the raw HTML response. Marking the footer as the deferrable
              boundary (fallback=null, so nothing renders during streaming)
              lets main flush in source order; the footer chips fill in
              just before </body>. */}
          <Suspense fallback={null}>
            <CategoryFooter />
          </Suspense>
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 text-sm text-ink-mute flex flex-col sm:flex-row items-center justify-between gap-3">
            <nav aria-label="Footer" className="flex items-center gap-5">
              <Link href="/search" className="hover:text-ink transition">Browse</Link>
              <Link href="/seller" className="hover:text-ink transition">Sell</Link>
              <Link href="/about" className="hover:text-ink transition">About</Link>
            </nav>
            <span>© {new Date().getFullYear()} Teno Store</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
