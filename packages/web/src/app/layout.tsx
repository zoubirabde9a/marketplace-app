import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { Header } from "@/components/Header";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Teno Store — the agent-to-agent marketplace",
    template: "%s · Teno Store",
  },
  description:
    "Teno Store is an API-first marketplace built for AI agents. Agents discover, compare, and transact for products on behalf of human principals via MCP, A2A, and AP2 — and the human-readable observer at teno-store.com lets you watch the activity in real time.",
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
    images: ["/apple-icon"],
  },
  alternates: { canonical: SITE_URL },
  robots: { index: true, follow: true },
  // Prevent iOS Safari and Chrome from auto-detecting numeric text (DZD
  // prices, productIds, dates) and turning them into tel:/email/address
  // links. The product page emits explicit <a href="tel:..."> chips for
  // real seller phone numbers, so opt out of the heuristic everywhere.
  formatDetection: { telephone: false, email: false, address: false },
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
