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
    const ld = container.querySelector('script[type="application/ld+json"]');
    expect(ld).not.toBeNull();
    const payload = JSON.parse(ld!.innerHTML);
    expect(payload["@type"]).toBe("AboutPage");
    expect(payload.name).toBe("About Teno Store");
    expect(payload.inLanguage).toBe("en");
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
