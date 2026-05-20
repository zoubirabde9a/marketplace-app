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
    // Page is single-language French now (English deep-dive removed).
    expect(payload.inLanguage).toEqual(["fr"]);
    // Must reference the homepage's WebSite/#website and Organization/#organization
    // anchors so Google can resolve all three documents into a single entity graph.
    expect(payload.isPartOf?.["@id"]).toMatch(/#website$/);
    expect(payload.about?.["@id"]).toMatch(/#organization$/);
  });

  it("emits FAQPage JSON-LD whose Q&A pairs all appear verbatim in the rendered body", () => {
    const { container } = render(AboutPage());
    const scripts = Array.from(container.querySelectorAll('script[type="application/ld+json"]'));
    const faq = scripts
      .map((s) => JSON.parse(s.innerHTML))
      .find((d) => d["@type"] === "FAQPage");
    expect(faq).toBeDefined();
    expect(faq.inLanguage).toBe("fr");
    expect(faq.isPartOf?.["@id"]).toMatch(/#website$/);
    // Speakable annotation tells voice/AI search engines which spans to
    // read aloud as snippets. CSS selectors must point at elements that
    // actually exist in the rendered page.
    expect(faq.speakable?.["@type"]).toBe("SpeakableSpecification");
    expect(Array.isArray(faq.speakable?.cssSelector)).toBe(true);
    for (const sel of faq.speakable.cssSelector) {
      // The first selector targets an ID; verify it resolves. The combinator
      // selectors (sibling/descendant) won't all resolve via querySelector
      // depending on test render shape, so we only enforce ID selectors here.
      if (sel.startsWith("#") && !sel.includes(" ")) {
        expect(container.querySelector(sel)).not.toBeNull();
      }
    }
    expect(Array.isArray(faq.mainEntity)).toBe(true);
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(4);
    expect(faq.mainEntity.length).toBeLessThanOrEqual(8);
    // Google requires every FAQ answer to be visible on the page. Verify by
    // searching the rendered text — mismatched structured/visible content
    // triggers manual actions.
    const bodyText = container.textContent ?? "";
    for (const entry of faq.mainEntity) {
      expect(entry["@type"]).toBe("Question");
      expect(entry.acceptedAnswer?.["@type"]).toBe("Answer");
      expect(bodyText).toContain(entry.name);
      expect(bodyText).toContain(entry.acceptedAnswer.text);
    }
  });

  it("includes internal links to /search and /seller", () => {
    const { container } = render(AboutPage());
    const links = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toContain("/search");
    expect(links).toContain("/seller");
  });
});
