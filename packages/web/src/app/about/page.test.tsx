import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import AboutPage, { metadata } from "./page";

afterEach(() => cleanup());

describe("AboutPage", () => {
  it("declares /about as its canonical URL", () => {
    expect(metadata.alternates?.canonical).toBe("/about");
  });

  it("emits AboutPage JSON-LD that cross-references the homepage WebSite + Organization", () => {
    const { container } = render(AboutPage());
    // Page now ships TWO ld+json blocks (BreadcrumbList + AboutPage).
    // Find the AboutPage one specifically.
    const scripts = Array.from(container.querySelectorAll('script[type="application/ld+json"]'));
    const payload = scripts
      .map((s) => JSON.parse(s.innerHTML))
      .find((d) => d["@type"] === "AboutPage")!;
    expect(payload).toBeDefined();
    expect(payload["@type"]).toBe("AboutPage");
    expect(payload.name).toBe("À propos de Teno Store");
    // Page now ships French primary content + English deep-dive (iter-12);
    // inLanguage updated to reflect both. Order matters for some validators
    // — French first since it's the primary signal.
    expect(payload.inLanguage).toEqual(["fr", "en"]);
    // Must reference the homepage's WebSite/#website and Organization/#organization
    // anchors so Google can resolve all three documents into a single entity graph.
    expect(payload.isPartOf?.["@id"]).toMatch(/#website$/);
    expect(payload.about?.["@id"]).toMatch(/#organization$/);
  });

  it("includes internal links to /search and /seller", () => {
    const { container } = render(AboutPage());
    const links = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toContain("/search");
    expect(links).toContain("/seller");
  });
});
