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
  // Apple — powers Siri, Spotlight and Apple Intelligence retrieval
  "Applebot",
  "Applebot-Extended",
  // Amazon — Alexa Answers and broader Amazon LLM retrieval
  "Amazonbot",
  // ByteDance / TikTok search
  "Bytespider",
  // Diffbot (used by Anthropic + many other LLM training corpora)
  "Diffbot",
  // Cohere
  "cohere-ai",
  "cohere-training-data-crawler",
  // You.com
  "YouBot",
  // Mistral / Le Chat retrieval
  "MistralAI-User",
  // DuckDuckGo's AI assist crawler (above and beyond DuckDuckBot search)
  "DuckAssistBot",
];

// Social-share scrapers — these aren't AI crawlers, they're the bots that
// fetch a URL the moment someone pastes it into a chat / post to render
// the link preview. Already allowed by the wildcard rule, but spelling
// them out explicitly avoids any future Disallow regression catching them
// in the crossfire.
const SOCIAL_SHARE_USER_AGENTS = [
  "facebookexternalhit",
  "Facebot",
  "Twitterbot",
  "LinkedInBot",
  "Slackbot",
  "Discordbot",
  "WhatsApp",
  "TelegramBot",
  "Pinterestbot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // /store/ is the canonical seller-storefront URL (commit d62bd2f).
        // `/seller$` (end-of-URL anchor) is the public onboarding page;
        // the trailing-slash variant below disallows /seller/dashboard etc.
        // Without the `$` the two rules overlapped and crawlers had to
        // fall back to most-specific-match semantics to do the right thing.
        allow: ["/", "/search", "/product/", "/store/", "/seller$", "/about", "/blog", "/c/"],
        // /api/ is internal; /login is the auth ceremony page; /seller/ subpaths
        // (dashboard/contact/products) are auth-required and have no SEO value;
        // /s/ are private snapshot links that are public-token addressed.
        disallow: ["/api/", "/login", "/seller/", "/s/"],
      },
      ...[...AI_USER_AGENTS, ...SOCIAL_SHARE_USER_AGENTS].map((ua) => ({
        userAgent: ua,
        allow: ["/", "/search", "/product/", "/store/", "/seller$", "/about", "/blog", "/c/"],
        disallow: ["/api/", "/login", "/seller/", "/s/"],
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
