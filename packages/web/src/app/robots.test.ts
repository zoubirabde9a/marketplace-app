import { describe, expect, it } from "vitest";
import robots from "./robots";

describe("robots()", () => {
  const result = robots();
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules!];

  it("includes a wildcard rule that disallows /api/", () => {
    const wildcard = rules.find((r) => r.userAgent === "*");
    expect(wildcard).toBeDefined();
    expect(wildcard?.disallow).toContain("/api/");
    expect(wildcard?.allow).toEqual(expect.arrayContaining(["/", "/search", "/product/"]));
  });

  it("explicitly allows current AI crawler user-agents (training + retrieval)", () => {
    const aiAgents = [
      "GPTBot", "OAI-SearchBot", "ChatGPT-User",
      "ClaudeBot", "Claude-SearchBot", "Claude-User",
      "Google-Extended",
      "PerplexityBot", "Perplexity-User",
      "Meta-ExternalAgent",
      "CCBot",
    ];
    for (const ua of aiAgents) {
      const rule = rules.find((r) => r.userAgent === ua);
      expect(rule, `expected a rule for ${ua}`).toBeDefined();
      expect(rule?.allow).toEqual(expect.arrayContaining(["/", "/search", "/product/"]));
    }
  });

  it("does not advertise deprecated Anthropic user-agents", () => {
    // anthropic-ai and Claude-Web are no longer active per Anthropic's 2026 guidance.
    expect(rules.find((r) => r.userAgent === "anthropic-ai")).toBeUndefined();
    expect(rules.find((r) => r.userAgent === "Claude-Web")).toBeUndefined();
  });

  it("emits a sitemap URL ending in /sitemap.xml", () => {
    const sitemap = Array.isArray(result.sitemap) ? result.sitemap[0] : result.sitemap;
    expect(sitemap).toMatch(/\/sitemap\.xml$/);
  });

  it("sets a host", () => {
    expect(result.host).toBeTruthy();
  });
});
