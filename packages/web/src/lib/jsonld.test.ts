import { describe, expect, it } from "vitest";
import { jsonLdString } from "./jsonld";

describe("jsonLdString", () => {
  it("escapes </script> in untrusted strings to prevent script-tag breakouts", () => {
    const out = jsonLdString({
      name: "Evil </script><img src=x onerror=alert(1)>",
    });
    expect(out).not.toMatch(/<\/script>/i);
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
  });

  it("escapes <, >, and & to their JSON-safe unicode forms", () => {
    const out = jsonLdString({ html: "<a href='x?a=1&b=2'>link</a>" });
    expect(out).toContain("\\u003c");
    expect(out).toContain("\\u003e");
    expect(out).toContain("\\u0026");
    // The original ampersand-style text must NOT appear as raw '&' outside a
    // unicode escape — assert there are no unescaped & by parsing back and
    // confirming the round-trip yields the original characters.
    const parsed = JSON.parse(out) as { html: string };
    expect(parsed.html).toBe("<a href='x?a=1&b=2'>link</a>");
  });

  it("produces valid JSON that parses back to the same object", () => {
    const input = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Iphone 15 — Neuf scellé & garanti",
      offers: { "@type": "Offer", price: "28000.00", priceCurrency: "DZD" },
    };
    const parsed = JSON.parse(jsonLdString(input));
    expect(parsed).toEqual(input);
  });
});
