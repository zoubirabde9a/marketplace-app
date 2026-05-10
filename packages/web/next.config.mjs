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
  },
  // Legacy favicon and apple-touch-icon URLs that browsers / RSS readers /
  // social-share scrapers (FB, Slack, X, iOS Safari) probe regardless of
  // <link rel=icon>. Without these the requests hit the catch-all 404
  // handler — minor quality signal, log noise, occasional broken
  // social-card icons. Permanent redirects to the modern Next-generated
  // assets that already 200.
  async headers() {
    return [
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
        ],
      },
      {
        // /.well-known/agents.json + security.txt — same rationale.
        source: "/.well-known/:file(agents.json|security.txt)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" },
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
