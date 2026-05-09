import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

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

  it("renders the value-prop bullets explaining what selling looks like", async () => {
    const tree = await SellerLandingPage();
    const { container } = render(tree);
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
      user: { id: "u1", email: "x@y.z", displayName: "Test", picture: null },
    });
    await expect(SellerLandingPage()).rejects.toThrowError("REDIRECT:/seller/dashboard");
  });
});
