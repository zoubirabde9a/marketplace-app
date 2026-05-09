// Home page. Two states:
//   - signed in:  personalized "Hi, <name>" header + agent list + activity feed
//   - signed out: marketing landing with WebSite JSON-LD + sign-in CTA
//
// Auth state is read from the mp_session cookie via getCurrentUser(). The home
// page is always dynamic (cookies are per-request).

import Link from "next/link";
import { getCurrentUser } from "@/lib/sellerSession";
import { getMyActivity, searchProducts } from "@/lib/api";
import type { SearchHit } from "@/lib/api";
import { AgentActivity } from "@/components/AgentActivity";
import { ProductGrid } from "@/components/ProductGrid";
import { jsonLdString } from "@/lib/jsonld";

export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

export default async function Home() {
  const me = await getCurrentUser();

  if (me) {
    let activity;
    try {
      activity = await getMyActivity(me.jwt);
    } catch {
      // API hiccup — degrade gracefully to the empty-state view rather than crashing the home page.
      activity = { user: { id: me.user.id, email: me.user.email, displayName: me.user.displayName, picture: me.user.picture }, agents: [], recentActions: [] };
    }
    return <AgentActivity data={activity} />;
  }

  let recent: SearchHit[] = [];
  try {
    const r = await searchProducts({ sort: "newest", limit: 8 });
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
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: "Teno Store",
        alternateName: "Teno Store — agent observer",
        description:
          "Teno Store is an agent-to-agent marketplace. Watch what your AI agent is searching, browsing and buying in real time.",
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
        name: "Teno Store",
        url: SITE_URL,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_URL}/icon.svg`,
        },
      },
    ],
  };

  return (
    <section className="relative">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(websiteJsonLd) }}
      />
      <div className="absolute inset-0 bg-grid opacity-50 pointer-events-none [mask-image:radial-gradient(closest-side,black,transparent)]" />
      <div className="relative pt-24 pb-16 text-center max-w-3xl mx-auto">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs text-accent bg-accent/10 border border-accent/30 mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" /> live
        </span>
        <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight bg-gradient-to-b from-ink to-ink-soft bg-clip-text text-transparent">
          Watch your agent shop, in real time.
        </h1>
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
            className="inline-flex h-11 px-5 items-center rounded-xl bg-bg-soft border border-line text-ink-soft hover:border-accent/40 hover:text-ink transition"
          >
            Browse the catalog
          </Link>
        </div>
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          <Card title="Deep-linked searches" body="When your agent narrows a search, you get a URL that mirrors the same filters and results." />
          <Card title="Full product detail" body="Photos, variants, prices, attributes, and seller info — exactly what the agent saw." />
          <Card title="Trust signals" body="Counterfeit risk, stock state, and seller-supplied content tagged as untrusted by default." />
        </div>
      </div>
      {recent.length > 0 && (
        <section className="mt-8" aria-labelledby="recent-heading">
          <div className="flex items-baseline justify-between mb-4">
            <h2 id="recent-heading" className="text-xl font-semibold tracking-tight">Recently posted</h2>
            <Link href="/search" className="text-sm text-ink-soft hover:text-ink transition">See all →</Link>
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
