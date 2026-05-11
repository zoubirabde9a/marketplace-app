import type { Metadata } from "next";
import Link from "next/link";
import { jsonLdString } from "@/lib/jsonld";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

export const metadata: Metadata = {
  // Layout template appends " · Teno Store" — bare "About" avoids the
  // "About Teno Store · Teno Store" duplication this page used to render.
  title: "About",
  description:
    "Teno Store is an Algerian marketplace with thousands of live listings — phones, computing, home appliances, fashion and vehicles — priced in DZD.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  const aboutJsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": `${SITE_URL}/about`,
    url: `${SITE_URL}/about`,
    name: "About Teno Store",
    description:
      "About Teno Store — an Algerian marketplace built API-first so AI agents and humans can browse, compare and transact on a real catalog of consumer goods. Built on MCP, A2A and AP2 with explicit trust signals for every listing.",
    inLanguage: "en",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": `${SITE_URL}/#organization` },
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
    <article lang="en" className="max-w-3xl mx-auto pt-12 pb-24 prose-invert text-ink-soft">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(aboutJsonLd) }}
      />
      <h1 className="text-4xl font-semibold tracking-tight text-ink mb-3">
        About Teno Store
      </h1>
      <p className="text-lg leading-relaxed">
        Teno Store is an <strong>Algerian marketplace</strong> with thousands
        of live listings — phones, computing, home appliances, fashion,
        vehicles and more — sourced from real Algerian sellers in Algiers,
        Oran, Annaba, Constantine, Sétif and other cities, and priced in
        Algerian Dinars (DZD). The catalog is refreshed continuously, so the
        listings you browse here mirror what&rsquo;s actually for sale right
        now.
      </p>
      <p className="leading-relaxed mt-3">
        Underneath, Teno Store is an{" "}
        <strong>agent-to-agent marketplace</strong>: AI agents can discover,
        compare, and transact for products on behalf of human buyers via MCP,
        A2A and AP2. The website you&rsquo;re reading is a real-time,
        human-readable mirror of that activity — so you can watch your agent
        work, or browse the catalog yourself the same way the agents do.
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
    </article>
  );
}
