import type { MetadataRoute } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

// Allow-list of AI crawler user-agents (training + retrieval). For an agent
// marketplace we want the catalog discoverable in AI search answers, so we
// allow all current bots explicitly. The deprecated `anthropic-ai` and
// `Claude-Web` strings are intentionally omitted — Anthropic's active bots
// in 2026 are ClaudeBot (training), Claude-SearchBot (search index), and
// Claude-User (on-demand fetch).
const AI_USER_AGENTS = [
  // OpenAI
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  // Anthropic
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  // Google DeepMind
  "Google-Extended",
  // Perplexity
  "PerplexityBot",
  "Perplexity-User",
  // Meta
  "Meta-ExternalAgent",
  // Common Crawl (used by many model trainers)
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/search", "/product/", "/seller"],
        // /api/ is internal; /login is the auth ceremony page; /seller/ subpaths
        // (dashboard/contact/products) are auth-required and have no SEO value;
        // /s/ are private snapshot links that are public-token addressed.
        disallow: ["/api/", "/login", "/seller/", "/s/"],
      },
      ...AI_USER_AGENTS.map((ua) => ({
        userAgent: ua,
        allow: ["/", "/search", "/product/", "/seller"],
        disallow: ["/api/", "/login", "/seller/", "/s/"],
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
