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
      // Title-case URL variants. Probed live: /Search, /Product/<id>,
      // /About all returned 404. External links, copy-pastes, and the
      // occasional mobile keyboard auto-capitalisation hit these. Pattern
      // covers the most common typo (Initial-cap); all-caps and mixed-case
      // are out of scope for this static-redirect approach (middleware
      // would catch all but cost runtime on every request).
      { source: "/Search", destination: "/search", permanent: true },
      { source: "/Search/:path*", destination: "/search/:path*", permanent: true },
      { source: "/Product/:id", destination: "/product/:id", permanent: true },
      { source: "/About", destination: "/about", permanent: true },
      { source: "/Seller", destination: "/seller", permanent: true },
      { source: "/Seller/:path*", destination: "/seller/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
