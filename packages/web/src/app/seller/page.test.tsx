import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/sellerSession", () => ({
  getCurrentUser: vi.fn(async () => null),
}));

// next/navigation.redirect throws to halt rendering; surface as an identifiable error.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import SellerLandingPage, { metadata } from "./page";

afterEach(() => cleanup());

describe("SellerLandingPage (signed-out)", () => {
  it("declares /seller as its canonical URL", () => {
    expect(metadata.alternates?.canonical).toBe("/seller");
  });

  it("emits WebPage JSON-LD cross-referencing the homepage WebSite + Organization", async () => {
    const tree = await SellerLandingPage();
    const { container } = render(tree as React.ReactElement);
    // Page ships TWO ld+json blocks (BreadcrumbList + WebPage). Find WebPage.
    const scripts = Array.from(container.querySelectorAll('script[type="application/ld+json"]'));
    const payload = scripts
      .map((s) => JSON.parse(s.innerHTML))
      .find((d) => d["@type"] === "WebPage")!;
    expect(payload).toBeDefined();
    expect(payload["@type"]).toBe("WebPage");
    expect(payload.name).toBe("Vendre sur Teno Store");
    expect(payload.isPartOf?.["@id"]).toMatch(/#website$/);
    expect(payload.about?.["@id"]).toMatch(/#organization$/);
  });

  it("renders the value-prop bullets explaining what selling looks like", async () => {
    const tree = await SellerLandingPage();
    const { container } = render(tree as React.ReactElement);
    const text = container.textContent ?? "";
    // Three bullets in plain French — assert on substantive substrings so
    // copy can evolve without breaking the test entirely. The bullets cover:
    // (1) audience reach without technical setup, (2) speed of publishing in
    // dinars, (3) the buyer-contact path that the seller actually uses.
    expect(text).toMatch(/[Aa]cheteurs alg/);
    expect(text).toMatch(/dinars/i);
    expect(text).toMatch(/[Tt]éléphone/);
  });

  it("redirects signed-in sessions to the dashboard", async () => {
    const { getCurrentUser } = await import("@/lib/sellerSession");
    vi.mocked(getCurrentUser).mockResolvedValueOnce({
      jwt: "j",
      user: {
        id: "u1",
        email: "x@y.z",
        emailVerified: true,
        displayName: "Test",
        picture: null,
        status: "active",
        createdAt: "2026-05-09T00:00:00Z",
      },
    });
    await expect(SellerLandingPage()).rejects.toThrowError("REDIRECT:/seller/dashboard");
  });
});
