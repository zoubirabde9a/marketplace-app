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
    const ld = container.querySelector('script[type="application/ld+json"]');
    expect(ld).not.toBeNull();
    const payload = JSON.parse(ld!.innerHTML);
    expect(payload["@type"]).toBe("WebPage");
    expect(payload.name).toBe("Sell on Teno Store");
    expect(payload.isPartOf?.["@id"]).toMatch(/#website$/);
    expect(payload.about?.["@id"]).toMatch(/#organization$/);
  });

  it("renders the value-prop bullets explaining what selling looks like", async () => {
    const tree = await SellerLandingPage();
    const { container } = render(tree as React.ReactElement);
    const text = container.textContent ?? "";
    // Three bullets from iteration 47, asserted on substantive substrings so
    // copy can evolve without breaking the test entirely.
    expect(text).toMatch(/MCP, A2A, and HTTP/i);
    expect(text).toMatch(/[Cc]ounterfeit/);
    expect(text).toMatch(/own currency/i);
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
