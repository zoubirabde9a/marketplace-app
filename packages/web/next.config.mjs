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
    ];
  },
};

export default nextConfig;
