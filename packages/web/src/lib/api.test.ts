import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSearchQuery,
  getProduct,
  searchProducts,
  type ApiError,
  type ProductDetail,
  type SearchResponse,
} from "./api";

const okResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const errResponse = (status: number, statusText: string, body = ""): Response =>
  ({
    ok: false,
    status,
    statusText,
    json: async () => ({}),
    text: async () => body,
  }) as unknown as Response;

describe("buildSearchQuery", () => {
  it("returns an empty string when no inputs are set", () => {
    expect(buildSearchQuery({})).toBe("");
  });

  it("encodes simple scalar fields", () => {
    const qs = buildSearchQuery({ q: "shoes", brand: "Nike", limit: 25, sort: "price_asc" });
    const params = new URLSearchParams(qs);
    expect(params.get("q")).toBe("shoes");
    expect(params.get("brand")).toBe("Nike");
    expect(params.get("limit")).toBe("25");
    expect(params.get("sort")).toBe("price_asc");
  });

  it("appends repeated array fields and attribute filters", () => {
    const qs = buildSearchQuery({
      category: ["c1", "c2"],
      sellerId: ["s1", "s2"],
      attributes: { color: "red", size: "M" },
    });
    const params = new URLSearchParams(qs);
    expect(params.getAll("category")).toEqual(["c1", "c2"]);
    expect(params.getAll("sellerId")).toEqual(["s1", "s2"]);
    expect(params.get("attr.color")).toBe("red");
    expect(params.get("attr.size")).toBe("M");
  });

  it("only emits boolean flags when truthy", () => {
    const qsOff = buildSearchQuery({ includeOutOfStock: false, fuzzy: false });
    expect(qsOff).toBe("");
    const qsOn = buildSearchQuery({ includeOutOfStock: true, fuzzy: true });
    const params = new URLSearchParams(qsOn);
    expect(params.get("includeOutOfStock")).toBe("true");
    expect(params.get("fuzzy")).toBe("true");
  });
});

describe("searchProducts", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls /v1/products with a built query string and returns the parsed body", async () => {
    const body: SearchResponse = {
      data: [],
      pagination: { cursor: null, totalEstimate: 0 },
      facets: { brands: [], currencies: [], sellers: [], categories: [], priceRanges: [] },
    };
    fetchMock.mockResolvedValueOnce(okResponse(body));

    const result = await searchProducts({ q: "phone", brand: "Acme" });
    expect(result).toEqual(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/v1\/products\?/);
    expect(String(url)).toContain("q=phone");
    expect(String(url)).toContain("brand=Acme");
    expect((init as RequestInit).cache).toBe("no-store");
  });

  it("omits the query string when no inputs are provided", async () => {
    const body: SearchResponse = {
      data: [],
      pagination: { cursor: null, totalEstimate: 0 },
      facets: { brands: [], currencies: [], sellers: [], categories: [], priceRanges: [] },
    };
    fetchMock.mockResolvedValueOnce(okResponse(body));
    await searchProducts({});
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/v1\/products$/);
  });

  it("throws an ApiError carrying the status and body on non-2xx responses", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(500, "Server Error", "boom"));
    let caught: ApiError | undefined;
    try {
      await searchProducts({});
    } catch (e) {
      caught = e as ApiError;
    }
    expect(caught).toBeDefined();
    expect(caught?.status).toBe(500);
    expect(caught?.detail).toBe("boom");
    expect(caught?.message).toContain("500");
  });
});

describe("getProduct", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the product when the API responds OK", async () => {
    const product = {
      productId: "p1",
      viewUrl: "/p/p1",
      title: { role: "untrusted_content", origin: "seller", value: "Widget" },
      description: null,
      attributes: {},
      variants: [],
      sellerId: "s1",
      sellerDisplayName: "S",
      sellerPhone: null,
      sellerWhatsapp: null,
      sellerWebsite: null,
      categoryIds: [],
      shipsTo: [],
      counterfeitRisk: "low",
      images: [],
      heroImageUrl: null,
      heroMediaId: null,
    } satisfies ProductDetail;
    fetchMock.mockResolvedValueOnce(okResponse(product));

    const result = await getProduct("p1");
    expect(result?.productId).toBe("p1");
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/v1\/products\/p1$/);
  });

  it("returns null on a 404 response", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(404, "Not Found"));
    const result = await getProduct("missing");
    expect(result).toBeNull();
  });

  it("re-throws non-404 errors", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(500, "Server Error"));
    await expect(getProduct("x")).rejects.toMatchObject({ status: 500 });
  });

  it("URL-encodes the product id", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(404, "Not Found"));
    await getProduct("a/b c");
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/products/a%2Fb%20c");
  });
});
