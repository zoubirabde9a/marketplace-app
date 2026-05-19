import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // standalone bundles only the files Next.js actually needs into .next/standalone,
  // which is what packages/web/Dockerfile copies into the runtime image.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }, { protocol: "http", hostname: "**" }],
    // WebP only — AVIF encode time with sharp is ~5x WebP and the optimizer
    // is already CPU-bound during crawler bursts (2026-05-17 audit: one Node
    // core pinned at 149% under /_next/image load). The CWV gain from AVIF
    // isn't worth keeping the queue long enough for Caddy to 504.
    formats: ["image/webp"],
    // 1 year. Ouedkniss CDN URLs are content-addressed (path embeds the
    // listing's image id) and never change once a product is listed, so
    // there's no correctness cost to a long TTL — and a cold optimizer
    // request only pays the sharp transcode once per (url, size) tuple.
    minimumCacheTTL: 60 * 60 * 24 * 365,
  },
  // Legacy favicon and apple-touch-icon URLs that browsers / RSS readers /
  // social-share scrapers (FB, Slack, X, iOS Safari) probe regardless of
  // <link rel=icon>. Without these the requests hit the catch-all 404
  // handler — minor quality signal, log noise, occasional broken
  // social-card icons. Permanent redirects to the modern Next-generated
  // assets that already 200.
  async headers() {
    // Content-Security-Policy in Report-Only mode (anomaly [7]). We don't
    // know yet which third-party origins the site touches at runtime, so
    // shipping an enforcing CSP risks breaking real users. Report-Only
    // delivers violations to the browser console where we can observe what
    // we'd block before promoting to enforce. No report-uri/report-to yet
    // — violations are visible in DevTools only, which is the right scope
    // for the initial learning pass.
    const cspReportOnly = [
      "default-src 'self'",
      // 'unsafe-inline' covers the inline RSC payload + Next hydration
      // bootstrap scripts. Tighten with nonces once the report log is
      // clean. 'unsafe-eval' is here for Next dev/RSC fallback; remove if
      // the report log doesn't show eval hits in steady state.
      // accounts.google.com hosts the gsi/client SDK loaded by the seller
      // Google Sign-In button (app/seller/GoogleSignInButton.tsx).
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://apis.google.com",
      "style-src 'self' 'unsafe-inline' https://accounts.google.com",
      // images: self + data:/blob: for inline-encoded thumbnails; https:
      // for Next/image-optimized output that may proxy through any CDN.
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // accounts.google.com is the gsi token endpoint the SDK calls; the
      // SDK also opens a hidden iframe under that origin for the
      // OAuth/One-Tap exchange — needs both connect-src and frame-src.
      "connect-src 'self' https://api.teno-store.com https://accounts.google.com",
      "frame-src 'self' https://accounts.google.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");
    return [
      {
        // Site-wide CSP report-only header. Listed first so it applies to
        // every response; subsequent entries below add per-path Cache-
        // Control / CORS without clobbering it.
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
        ],
      },
      {
        // Static-y discovery files served from packages/web/public/. They
        // change once per deploy; Next ships them with max-age=0 by default
        // which means Cloudflare can never cache, and every AI/RSS/social
        // crawler hits origin. 1-hour public cache + 24h SWR drops the
        // origin pressure dramatically; if we deploy a change to one of
        // these the next deploy invalidates the CDN cache anyway.
        source: "/:file(robots.txt|llms.txt|81b0a3ff408a96ef5c0381a78aae7f58.txt)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" },
          // Public-by-design discovery files. Without Access-Control-Allow-
          // Origin, browser-based tooling (SEO debuggers, llms.txt parsers,
          // agent-discovery validators) can't fetch them cross-origin —
          // they see a CORS error even though the content is intentionally
          // public. Server-side crawlers (Googlebot, GPTBot, ClaudeBot)
          // don't enforce browser CORS, so the missing header was invisible
          // until someone tried to read these from JS in a tab.
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        // /.well-known/agents.json + security.txt — same rationale.
        source: "/.well-known/:file(agents.json|security.txt)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        // /manifest.webmanifest is generated by Next from app/manifest.ts and
        // ships with the dynamic-route default `max-age=0, must-revalidate`.
        // Browsers re-fetch it on install + on visibility changes; Lighthouse
        // PWA audits also re-fetch each run. It only changes once per deploy.
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" },
        ],
      },
      {
        // /sitemap.xml ships with Next's default `max-age=0, must-revalidate`
        // because it's a dynamic route. That means Cloudflare cannot cache
        // it — every Googlebot/Bingbot/IndexNow hit reaches origin and
        // triggers a full render of all ~14k URLs. The module-level harvest
        // cache in sitemap.ts already keeps the render fast, but origin
        // still pays the work. A short edge TTL is safe: catalog changes
        // every few minutes, and sitemap lastmod values are advisory.
        source: "/sitemap.xml",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, s-maxage=300, stale-while-revalidate=1800" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        // Atom feed: public-by-design feed-discovery content. Browser-based
        // RSS readers / AI-search feed validators need cross-origin access.
        source: "/feed.xml",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        // Category landings (/c/[slug]) — Next ships dynamic-route HTML with
        // `max-age=0, must-revalidate`, so Cloudflare never shared-caches and
        // every crawler hit pays the full ~3.8 s SSR (2026-05-17 audit:
        // 136.117.185.78 price-monitoring bot). Catalog rotates often enough
        // that 5 min edge TTL is safe; SWR lets stale serve while origin
        // refreshes.
        source: "/c/:slug*",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=3600" },
        ],
      },
      {
        // Product pages — same SSR-cost problem as /c/*. Per-product pages
        // change rarely (price/stock edits are infrequent for scraped
        // listings), so a longer 10 min edge TTL is appropriate.
        source: "/product/:id*",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=600, stale-while-revalidate=3600" },
        ],
      },
      {
        // /s/{id} agent-snapshot pages are token-addressed (the unguessable id
        // is the credential, see api/middleware/auth.ts) and immutable until
        // the underlying snapshot expires 24h after creation. Next's dynamic-
        // route default ships 'private, no-cache, no-store' so every viewer
        // hit origin even though many recipients typically share one URL
        // (audit-trail / proof-of-what-the-agent-saw flows). Match the API
        // /v1/snapshots/{id} cache policy (commit 480c816) so the WEB page
        // wrapping the same data is just as cacheable.
        source: "/s/:id",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400, immutable" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/favicon.ico", destination: "/icon.svg", permanent: true },
      { source: "/apple-touch-icon.png", destination: "/apple-icon", permanent: true },
      { source: "/apple-touch-icon-precomposed.png", destination: "/apple-icon", permanent: true },
      // PWA manifest legacy paths. Next 15 emits its manifest at the
      // modern .webmanifest extension; PWA installers and some crawlers
      // (Lighthouse, Edge "Install app") still probe the older paths.
      { source: "/manifest.json", destination: "/manifest.webmanifest", permanent: true },
      { source: "/site.webmanifest", destination: "/manifest.webmanifest", permanent: true },
      // Legacy security.txt path. RFC 9116 defines /.well-known/security.txt
      // as the canonical location, but plenty of scanners and operators
      // still probe the bare /security.txt path.
      { source: "/security.txt", destination: "/.well-known/security.txt", permanent: true },
      // Legacy sitemap-index variants. Some older crawlers probe these
      // names instead of /sitemap.xml. We don't actually emit a sitemap
      // INDEX (one file with <14k URLs covers everything well under the
      // spec's 50k-per-file limit), but the canonical sitemap is what
      // they want either way.
      { source: "/sitemap_index.xml", destination: "/sitemap.xml", permanent: true },
      { source: "/sitemap-index.xml", destination: "/sitemap.xml", permanent: true },
      // Legacy index file probes. Apache/nginx classic-CMS conventions
      // expose /index.html for the homepage; some directory listings,
      // copy-paste docs, and a few crawler implementations still hit
      // these. 404 is a quality-signal hit; redirect to canonical home.
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/index", destination: "/", permanent: true },
      { source: "/index.htm", destination: "/", permanent: true },
      { source: "/home", destination: "/", permanent: true },
      // NOTE: previously had Title-case → lowercase redirects here for
      // /Search, /Product/:id, /About, /Seller. They caused an infinite
      // redirect loop in production: Next.js's `redirects()` path matcher
      // is CASE-INSENSITIVE by default, so `/Product/:id` ALSO matched
      // `/product/<uuid>` (the canonical lowercase form) and 308'd it to
      // itself. Every product page broke for ~30 minutes after deploy.
      // Reverted; uppercase variants will 404 (which Google handles fine
      // — it's a far better failure mode than infinite redirect loops).
      // A correct case-redirect implementation needs middleware that
      // checks `request.nextUrl.pathname !== request.nextUrl.pathname.toLowerCase()`.
    ];
  },
};

export default nextConfig;
