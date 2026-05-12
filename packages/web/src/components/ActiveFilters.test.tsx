import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ActiveFilters } from "./ActiveFilters";

afterEach(() => cleanup());

function chips(container: HTMLElement) {
  return Array.from(container.querySelectorAll("a[aria-label]")).map((a) => {
    // Drop the trailing × glyph (visually a remove affordance, aria-hidden) so
    // the text matches the chip's logical label.
    const visible = a.querySelector("span:not([aria-hidden])");
    return {
      label: a.getAttribute("aria-label"),
      href: a.getAttribute("href"),
      text: (visible?.textContent ?? a.textContent ?? "").trim(),
    };
  });
}

describe("ActiveFilters", () => {
  it("returns null when there are no active filters", () => {
    const { container } = render(<ActiveFilters sp={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a chip for q with the chip text wrapped in smart quotes", () => {
    const { container } = render(<ActiveFilters sp={{ q: "phone" }} />);
    const c = chips(container);
    expect(c).toHaveLength(1);
    expect(c[0].text).toContain("phone");
    expect(c[0].label).toBe('Retirer le filtre : “phone”');
    expect(c[0].href).toBe("/search");
  });

  it("renders a brand chip and clearing it drops the brand param from the URL", () => {
    const { container } = render(
      <ActiveFilters sp={{ q: "phone", brand: "Acme" }} />,
    );
    const c = chips(container);
    const brandChip = c.find((x) => x.text === "Acme");
    expect(brandChip).toBeDefined();
    expect(brandChip!.href).toBe("/search?q=phone");
  });

  it("resolves sellerId UUIDs to display names when the lookup is provided", () => {
    const { container } = render(
      <ActiveFilters
        sp={{ sellerId: "0a1b2c3d-1111-2222-3333-444444444444" }}
        sellerDisplayNames={{
          "0a1b2c3d-1111-2222-3333-444444444444": "Acme Widgets",
        }}
      />,
    );
    const c = chips(container);
    expect(c).toHaveLength(1);
    expect(c[0].text).toBe("Acme Widgets");
    expect(c[0].label).toBe("Retirer le filtre : Acme Widgets");
  });

  it("falls back to a short-suffix label when no display name is available", () => {
    const { container } = render(
      <ActiveFilters sp={{ sellerId: "0a1b2c3d-1111-2222-3333-444444444444" }} />,
    );
    const c = chips(container);
    expect(c[0].text).toMatch(/vendeur \w{6}$/);
  });

  it("emits a 'tout effacer' link when more than one filter is active", () => {
    const { container } = render(
      <ActiveFilters sp={{ q: "phone", brand: "Acme" }} />,
    );
    const clearAll = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "tout effacer",
    );
    expect(clearAll).toBeDefined();
    expect(clearAll!.getAttribute("href")).toBe("/search");
  });

  it("ignores cursor when building chip-removal URLs", () => {
    const { container } = render(
      <ActiveFilters sp={{ q: "phone", cursor: "abc" }} />,
    );
    const c = chips(container);
    expect(c[0].href).toBe("/search");
  });
});
