// Edge middleware. Sole job: emit `Cache-Control: public, s-maxage=60,
// stale-while-revalidate=300` on indexable HTML pages WHEN the request is
// anonymous (no `mp_session` cookie). Logged-in requests keep Next.js's
// default `private, no-cache, no-store, max-age=0, must-revalidate` so
// personalized SSR content (Header user menu, signed-in home agent
// activity) is never served to other users by a shared cache.
//
// Why this matters: every indexable HTML page on the site (home / search /
// product / about / seller / storefront) has shipped with the framework's
// dynamic-route no-store default, which means Cloudflare cannot cache HTML.
// With 21k product URLs in the sitemap and ~470ms warm origin response,
// Googlebot's per-origin crawl rate is the bottleneck for catalog
// indexation depth and freshness. Letting anonymous responses sit at the
// edge for 60s + 5min SWR drops origin pressure ~10x for crawler / cold
// visitor traffic without touching the logged-in path.
//
// Vary: Cookie is set so any intermediate cache that does honor Vary keys
// the cache entry by cookie. Cloudflare's default behavior with Vary:
// Cookie is conservative — it doesn't cache unless an explicit Cache Rule
// allows; the operator-side companion to this change is a Cloudflare rule
// matching the same paths with "cookie `mp_session` absent → cache".
//
// Personalization-leak safety: even WITHOUT a Cloudflare rule, this is
// safe — if the user has a session cookie the public Cache-Control isn't
// emitted at all; if they don't, they're getting the same anonymous HTML
// every other anonymous visitor gets.

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "mp_session";

// Match the path shapes that ship indexable HTML. Bounded list rather than
// "everything" so middleware doesn't run on /_next/*, /api/*, or static
// assets — those have their own caching policies set in next.config.mjs.
const CACHEABLE_PATHS = [
  /^\/$/,
  /^\/about$/,
  /^\/seller$/,
  /^\/search$/,
  /^\/product\/[^/]+$/,
  /^\/store\/[^/]+$/,
];

export function middleware(req: NextRequest): NextResponse {
  const res = NextResponse.next();
  const path = req.nextUrl.pathname;
  if (!CACHEABLE_PATHS.some((re) => re.test(path))) return res;
  if (req.cookies.has(SESSION_COOKIE)) return res;
  // s-maxage=300 (5 min edge cache) + swr=1800 (30 min stale-while-revalidate
  // grace period). Bumped from the iter-15 defaults of 60/300 after the
  // iter-22 caddy-log analysis showed ClaudeBot at 163 req/min sustained,
  // p99 latency 9.8s, max 60s — 1% of crawler hits are very slow because
  // every request hits origin uncached. With Cloudflare activation the
  // longer TTL means a single cold render serves the next 5 min worth of
  // crawler hits to the same URL (plus 30 min of stale-while-revalidate
  // serving warmly), which is what actually buffers origin from the
  // sustained 2-3 reqs/sec crawler load. Ouedkniss-sourced product
  // listings have prices and availability that rarely change minute to
  // minute, so 5 min edge staleness is acceptable; the catalog seed loop
  // already runs at minute cadence so genuinely-new products surface to
  // crawlers via the sitemap (fresh lastmod every minute) regardless of
  // per-URL cache TTL.
  res.headers.set(
    "Cache-Control",
    "public, max-age=0, s-maxage=300, stale-while-revalidate=1800",
  );
  // Vary: Cookie tells caches that responses differ by cookie state — even
  // though we only emit public for cookieless requests, this is good
  // hygiene if a downstream cache ever inspects the header. Use append
  // (not set) because Next.js's framework layer sets its own Vary AFTER
  // middleware runs (`rsc, next-router-state-tree, …, Accept-Encoding`),
  // and a `.set()` call here gets clobbered. Appending leaves both lists
  // in the final Vary, which is what HTTP semantics expect anyway —
  // multiple Vary headers are token-OR'd by intermediaries.
  res.headers.append("Vary", "Cookie");
  return res;
}

export const config = {
  // Matcher needs to be a Next.js-recognized pattern. The runtime falls
  // back to CACHEABLE_PATHS for the actual emission decision; the matcher
  // just narrows what runs the middleware function at all.
  matcher: [
    "/",
    "/about",
    "/seller",
    "/search",
    "/product/:id",
    "/store/:id",
  ],
};
