import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import SnapshotPage from "./page";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

function mockFetch(impl: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return impl(url);
  }) as typeof globalThis.fetch;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("SnapshotPage", () => {

  it("renders search snapshot hits", async () => {
    const expiresAt = Date.now() + 23 * 60 * 60 * 1000; // 23h ahead
    mockFetch((url) => {
      expect(url).toMatch(/\/v1\/snapshots\/abc123$/);
      return jsonResponse({
        id: "abc123",
        kind: "search",
        input: { query: "blue widget" },
        output: {
          hits: [
            {
              productId: "prd_1",
              title: { role: "untrusted_content", origin: "seller:s1", value: "Blue Widget" },
              brand: "Acme",
              priceMinor: "1999",
              currency: "USD",
              inStock: true,
              sellerId: "slr_1",
              counterfeitRisk: "low",
              relevanceScore: 0.9,
            },
          ],
          totalEstimate: 1,
        },
        createdAt: Date.now() - 60_000,
        expiresAt,
      });
    });

    const tree = await SnapshotPage({ params: Promise.resolve({ id: "abc123" }) });
    const { container } = render(tree);

    expect(container.textContent).toContain("Blue Widget");
    expect(container.textContent).toContain("blue widget"); // query echoed
    expect(container.textContent).toContain("Acme");
    expect(container.textContent).toContain("19.99 USD");
    expect(container.textContent).toContain("Agent search snapshot");
  });

  it("renders product snapshot with variants", async () => {
    mockFetch(() =>
      jsonResponse({
        id: "p1",
        kind: "product",
        input: { productId: "prd_99" },
        output: {
          productId: "prd_99",
          title: { role: "untrusted_content", origin: "seller:s1", value: "Mega Gadget" },
          description: { role: "untrusted_content", origin: "seller:s1", value: "Best gadget." },
          brand: "Acme",
          sellerId: "slr_1",
          variants: [
            { id: "v1", sku: "SKU-A", priceMinor: "2500", currency: "USD", inStock: true },
            { id: "v2", sku: "SKU-B", priceMinor: "3500", currency: "USD", inStock: false },
          ],
        },
        createdAt: Date.now(),
        expiresAt: Date.now() + 86_400_000,
      }),
    );

    const tree = await SnapshotPage({ params: Promise.resolve({ id: "p1" }) });
    const { container } = render(tree);
    expect(container.textContent).toContain("Mega Gadget");
    expect(container.textContent).toContain("Best gadget.");
    expect(container.textContent).toContain("SKU-A");
    expect(container.textContent).toContain("25.00 USD");
    expect(container.textContent).toContain("SKU-B");
    expect(container.textContent).toContain("out");
  });

  it("renders the unavailable view when API returns 410 and the id is not a known entity", async () => {
    // 410 from /v1/snapshots/x, plus 404 from /v1/sellers/x and /v1/products/x
    // (the recogniseEntity probe). The id "x" isn't UUID-shaped so the entity
    // probes are skipped entirely; we just get the unavailable copy.
    mockFetch((url) => {
      if (url.includes("/v1/snapshots/")) return new Response("", { status: 410 });
      return new Response("", { status: 404 });
    });
    const tree = await SnapshotPage({ params: Promise.resolve({ id: "x" }) });
    const { container } = render(tree);
    expect(container.textContent).toMatch(/no longer stored|unavailable/i);
    expect(container.textContent).toMatch(/24 hours/i);
  });

  it("renders the not-found view when API returns 404", async () => {
    mockFetch(() => new Response("", { status: 404 }));
    const tree = await SnapshotPage({ params: Promise.resolve({ id: "missing" }) });
    const { container } = render(tree);
    expect(container.textContent).toMatch(/not found/i);
  });

  it("renders the access-denied view when API returns 401", async () => {
    mockFetch(() => new Response("", { status: 401 }));
    const tree = await SnapshotPage({ params: Promise.resolve({ id: "auth" }) });
    const { container } = render(tree);
    expect(container.textContent).toMatch(/access denied/i);
    expect(container.textContent).not.toMatch(/not found/i);
  });

  it("renders the access-denied view when API returns 403", async () => {
    mockFetch(() => new Response("", { status: 403 }));
    const tree = await SnapshotPage({ params: Promise.resolve({ id: "forbidden" }) });
    const { container } = render(tree);
    expect(container.textContent).toMatch(/access denied/i);
  });

  it("renders raw JSON for compare and recommend kinds", async () => {
    mockFetch(() =>
      jsonResponse({
        id: "c1",
        kind: "compare",
        input: { productIds: ["a", "b"] },
        output: { result: { rows: [{ a: 1 }, { a: 2 }] } },
        createdAt: Date.now(),
        expiresAt: Date.now() + 1000,
      }),
    );
    const tree = await SnapshotPage({ params: Promise.resolve({ id: "c1" }) });
    const { container } = render(tree);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("rows");
    expect(container.textContent).toContain("Agent compare snapshot");
  });
});
