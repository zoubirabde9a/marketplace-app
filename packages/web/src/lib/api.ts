// Server-side fetch helpers. All calls go through the marketplace REST API
// (`/v1/products`, `/v1/products/:id`). Untrusted seller-supplied fields are
// returned as `{role:"untrusted_content", origin, value}` envelopes; we keep
// that envelope intact and unwrap only at the render boundary.

const API_URL = (process.env.MARKETPLACE_API_URL ?? "http://localhost:3100").replace(/\/$/, "");

export type Untrusted = { role: "untrusted_content"; origin: string; value: string };

export interface SearchHit {
  productId: string;
  // Stripped from server-side search responses before they reach client
  // components — see comment in searchProducts() about the viewUrl leak.
  viewUrl?: string;
  title: Untrusted;
  brand?: string;
  priceMinor?: string;
  priceFromMinor?: string;
  priceToMinor?: string;
  variantCount?: number;
  currency?: string;
  rating?: number;
  ratingCount?: number;
  inStock: boolean;
  sellerId: string;
  sellerDisplayName: string | null;
  categoryIds: string[];
  counterfeitRisk: "low" | "elevated" | "high";
  relevanceScore: number;
  heroImageUrl: string | null;
  heroImage: { id: string; url: string; contentType: string; altText?: string } | null;
  imageCount?: number;
  postedAt?: string | null;
}

export interface Facets {
  brands: Array<{ value: string; count: number }>;
  currencies: Array<{ value: string; count: number }>;
  sellers: Array<{ value: string; displayName?: string | null; count: number }>;
  categories: Array<{ value: string; count: number }>;
  priceRanges: Array<{ currency: string; minMinor: string; maxMinor: string }>;
}

export interface SearchResponse {
  data: SearchHit[];
  pagination: { cursor: string | null; totalEstimate: number };
  facets: Facets;
}

export interface ProductDetail {
  productId: string;
  viewUrl: string;
  title: Untrusted;
  description: Untrusted | null;
  brand?: string;
  attributes: Record<string, Untrusted>;
  variants: Array<{ id: string; sku: string; priceMinor: string; currency: string; inStock: boolean }>;
  sellerId: string;
  sellerDisplayName: string | null;
  sellerPhone: string | null;
  sellerWhatsapp: string | null;
  sellerWebsite: string | null;
  categoryIds: string[];
  shipsTo: string[];
  counterfeitRisk: "low" | "elevated" | "high";
  images: Array<{ id: string; url: string; contentType: string; altText?: string; width?: number; height?: number }>;
  heroImageUrl: string | null;
  heroMediaId: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch { /* ignore */ }
    const err: ApiError = Object.assign(new Error(`API ${res.status} ${res.statusText}`), { status: res.status, detail });
    throw err;
  }
  return (await res.json()) as T;
}

export interface ApiError extends Error { status: number; detail: string; }

export interface SearchInput {
  q?: string;
  category?: string[];
  brand?: string;
  sellerId?: string[];
  priceMin?: string;
  priceMax?: string;
  currency?: string;
  shipsTo?: string;
  minRating?: number;
  includeOutOfStock?: boolean;
  fuzzy?: boolean;
  cursor?: string;
  limit?: number;
  sort?: "relevance" | "price_asc" | "price_desc" | "newest" | "rating";
  attributes?: Record<string, string>;
}

export function buildSearchQuery(input: SearchInput): string {
  const p = new URLSearchParams();
  if (input.q) p.set("q", input.q);
  for (const c of input.category ?? []) p.append("category", c);
  if (input.brand) p.set("brand", input.brand);
  for (const s of input.sellerId ?? []) p.append("sellerId", s);
  if (input.priceMin != null) p.set("priceMin", input.priceMin);
  if (input.priceMax != null) p.set("priceMax", input.priceMax);
  if (input.currency) p.set("currency", input.currency);
  if (input.shipsTo) p.set("shipsTo", input.shipsTo);
  if (input.minRating != null) p.set("minRating", String(input.minRating));
  if (input.includeOutOfStock) p.set("includeOutOfStock", "true");
  if (input.fuzzy) p.set("fuzzy", "true");
  if (input.cursor) p.set("cursor", input.cursor);
  if (input.limit != null) p.set("limit", String(input.limit));
  if (input.sort) p.set("sort", input.sort);
  for (const [k, v] of Object.entries(input.attributes ?? {})) p.append(`attr.${k}`, v);
  return p.toString();
}

export async function searchProducts(input: SearchInput): Promise<SearchResponse> {
  const qs = buildSearchQuery(input);
  const r = await request<SearchResponse>(`/v1/products${qs ? `?${qs}` : ""}`);
  // The API includes a `viewUrl` field on every hit pointing at its own
  // internal hostname (e.g. http://api:3100/v1/products/<id>). When we hand
  // SearchHit[] to client components the field is serialised into the RSC
  // payload — production probe (iter-30) showed 25 occurrences of
  // `http://api:3100` in the rendered HTML of /search?category=telephones.
  // Nothing in the UI consumes viewUrl (cards build /product/<id> from the
  // productId field), so stripping it here removes the leak entirely AND
  // shrinks the per-page payload.
  if (r?.data) {
    r.data = r.data.map(({ viewUrl: _viewUrl, ...rest }) => rest as SearchHit);
  }
  return r;
}

export async function getProduct(id: string): Promise<ProductDetail | null> {
  try {
    return await request<ProductDetail>(`/v1/products/${encodeURIComponent(id)}`);
  } catch (e) {
    // 404 is "no such product"; 400/422 is "malformed product id" — both are
    // user-equivalent to a missing page. Returning null lets the caller route
    // through notFound() so the response is a real 404 instead of a 5xx soft-404.
    const status = (e as ApiError).status;
    if (status === 404 || status === 400 || status === 422) return null;
    throw e;
  }
}

// --- Seller dashboard helpers ----------------------------------------------
// These call the API with a marketplace session bearer (the cookie holds the
// raw `mp_<jwt>` issued by POST /v1/auth/google). The API's auth middleware
// recognizes the session bearer on POST /v1/sellers, PATCH /v1/sellers/:id,
// and POST /v1/products and synthesizes a principal whose agentId is
// `user:<userId>`.

export interface MeResponse {
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    displayName: string | null;
    picture: string | null;
    status: string;
    createdAt: string;
  };
}

export interface SellerRecord {
  sellerId: string;
  displayName: string;
  ownerAgentId: string;
  productCount: number;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  createdAt: string;
}

export interface SellersListResponse {
  data: SellerRecord[];
  pagination: { cursor: string | null; totalEstimate: number };
}

async function authedRequest<T>(path: string, sessionJwt: string, init?: RequestInit): Promise<T> {
  return request<T>(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${sessionJwt}`,
    },
  });
}

export async function loginWithGoogle(idToken: string): Promise<{ sessionJwt: string; expiresIn: number; user: MeResponse["user"] }> {
  return request("/v1/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": cryptoRandomKey() },
    body: JSON.stringify({ idToken }),
  });
}

export async function exchangeAgentLink(code: string): Promise<{ sessionJwt: string; expiresIn: number; user: MeResponse["user"] }> {
  return request("/v1/auth/exchange-link", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": cryptoRandomKey() },
    body: JSON.stringify({ code }),
  });
}

export async function getMe(sessionJwt: string): Promise<MeResponse> {
  return authedRequest<MeResponse>("/v1/auth/me", sessionJwt);
}

export interface MyAgentSummary {
  id: string;
  name: string;
  kind: "buyer" | "seller" | "both";
  status: string;
  createdAt: number;
}

export interface AgentAction {
  id: string;
  agentId: string;
  agentName: string;
  toolName: string;
  scope: string;
  status: string;
  latencyMs: number;
  occurredAt: string;
  errorCode: string | null;
}

export interface MyActivityResponse {
  user: { id: string; email: string; displayName: string | null; picture: string | null } | null;
  agents: MyAgentSummary[];
  recentActions: AgentAction[];
}

export async function getMyActivity(sessionJwt: string): Promise<MyActivityResponse> {
  return authedRequest<MyActivityResponse>("/v1/me/activity", sessionJwt);
}

export async function listMySellers(sessionJwt: string, ownerAgentId: string): Promise<SellersListResponse> {
  return authedRequest<SellersListResponse>(
    `/v1/sellers?ownerAgentId=${encodeURIComponent(ownerAgentId)}&limit=50`,
    sessionJwt,
  );
}

export async function createSeller(
  sessionJwt: string,
  body: { displayName: string; phone?: string; whatsapp?: string; website?: string },
): Promise<SellerRecord & { ownerAgentId: string }> {
  return authedRequest("/v1/sellers", sessionJwt, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": cryptoRandomKey() },
    body: JSON.stringify(body),
  });
}

export async function updateSellerContact(
  sessionJwt: string,
  sellerId: string,
  patch: { phone?: string | null; whatsapp?: string | null; website?: string | null },
): Promise<SellerRecord> {
  return authedRequest(`/v1/sellers/${encodeURIComponent(sellerId)}`, sessionJwt, {
    method: "PATCH",
    headers: { "content-type": "application/json", "idempotency-key": cryptoRandomKey() },
    body: JSON.stringify(patch),
  });
}

export interface CreateProductInput {
  sellerId: string;
  title: string;
  description?: string;
  brand?: string;
  categoryIds?: string[];
  variants: Array<{ sku: string; priceMinor: string; currency: string; inStock?: boolean }>;
}

export interface CreateProductResponse {
  productId: string;
  sellerId: string;
  title: string;
  brand?: string;
  variants: Array<{ id: string; sku: string; priceMinor: string; currency: string; inStock: boolean }>;
  images: Array<{ id: string; url: string; contentType: string }>;
  heroMediaId: string | null;
  createdAt: string;
}

export async function createProduct(
  sessionJwt: string,
  input: CreateProductInput,
): Promise<CreateProductResponse> {
  return authedRequest("/v1/products", sessionJwt, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": cryptoRandomKey() },
    body: JSON.stringify(input),
  });
}

export async function listProductsBySeller(sellerId: string, sessionJwt?: string): Promise<SearchResponse> {
  const path = `/v1/products?sellerId=${encodeURIComponent(sellerId)}&includeOutOfStock=true&limit=100`;
  return sessionJwt ? authedRequest<SearchResponse>(path, sessionJwt) : request<SearchResponse>(path);
}

function cryptoRandomKey(): string {
  // Used as the idempotency-key on writes. The API's idempotency middleware
  // requires it on POST/PATCH. A fresh value per call is fine for our use.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
