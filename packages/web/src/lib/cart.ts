// Server-side cart + checkout helpers. The marketplace API exposes a per-cart
// resource keyed by the `x-mp-cart-id` header (anonymous) or session bearer
// (logged-in). We persist the anonymous cart id in an httpOnly cookie so
// Server Components can recover the cart without exposing the id to client JS.

import { cookies } from "next/headers";

const API_URL = (process.env.MARKETPLACE_API_URL ?? "http://localhost:3100").replace(/\/$/, "");

export const CART_COOKIE = "mp_cart_id";
// Order tokens are returned by POST /v1/checkout/confirm and let an anonymous
// buyer re-fetch their order. We stash the most-recent token in a cookie
// keyed by order id so /order/[id] can authenticate without a query-string.
export const ORDER_TOKEN_COOKIE_PREFIX = "mp_order_token_";

// 30 days. Long enough for a buyer to abandon the tab and come back without
// re-adding everything; short enough that stale carts age out.
const CART_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;
// 90 days. After this, anonymous buyers lose the ability to view their order
// confirmation page directly — they can still get the order number from the
// seller. Same horizon used by typical COD marketplaces.
const ORDER_TOKEN_MAX_AGE_S = 60 * 60 * 24 * 90;

export interface CartLine {
  variantId: string;
  sellerId: string;
  qty: number;
  unitPriceMinor: string;
  productId: string | null;
  title: string | null;
  sku: string | null;
  heroImageUrl: string | null;
}

export interface CartView {
  cartId: string;
  currency: string;
  ownerKind: "user" | "anonymous";
  lines: CartLine[];
  totals: {
    subtotalMinor: string;
    shippingMinor: string;
    taxMinor: string;
    discountMinor: string;
    tipMinor: string;
    totalMinor: string;
  };
}

export interface OrderConfirmation {
  orderId: string;
  publicNumber: string;
  status: string;
  currency: string;
  totals: { subtotalMinor: string; shippingMinor: string; taxMinor: string; totalMinor: string };
  lines: Array<{ variantId: string; sellerId: string; qty: number; unitPriceMinor: string }>;
  orderToken: string;
  createdAt: string;
}

async function readCartCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(CART_COOKIE)?.value ?? null;
}

async function writeCartCookie(cartId: string): Promise<void> {
  const jar = await cookies();
  jar.set(CART_COOKIE, cartId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE_S,
  });
}

async function clearCartCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(CART_COOKIE);
}

async function cartFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(init.headers as Record<string, string> | undefined ?? {}),
  };
  const cartId = await readCartCookie();
  if (cartId) headers["x-mp-cart-id"] = cartId;
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store" });
  const newCartId = res.headers.get("x-mp-cart-id");
  if (newCartId && newCartId !== cartId) await writeCartCookie(newCartId);
  return res;
}

async function readCartFromResponse(res: Response): Promise<CartView> {
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`cart_api_${res.status}:${txt.slice(0, 200)}`);
  }
  return (await res.json()) as CartView;
}

export async function getCart(): Promise<CartView | null> {
  // Don't call /v1/cart if we have no cookie yet — that would create an empty
  // anonymous cart on every page load just to read it. Empty cart = no cart.
  const existing = await readCartCookie();
  if (!existing) return null;
  const res = await cartFetch("/v1/cart");
  // Stale-cookie case: a cartId was set on the cookie but the server no longer
  // knows it (catalog rebuild, DB rotation, dev reset, server-side cleanup).
  // Treat the same as "no cart" AND drop the cookie so we don't keep firing
  // the dead lookup on every page load — and so the next add-to-cart starts
  // a fresh cart cleanly instead of trying to attach to a tombstoned id.
  if (res.status === 404) {
    await clearCartCookie();
    return null;
  }
  return readCartFromResponse(res);
}

export async function addToCart(variantId: string, qty: number): Promise<CartView> {
  const res = await cartFetch("/v1/cart/items", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": cryptoRandomKey() },
    body: JSON.stringify({ variantId, qty }),
  });
  return readCartFromResponse(res);
}

export async function updateCartQty(variantId: string, qty: number): Promise<CartView> {
  const res = await cartFetch(`/v1/cart/items/${encodeURIComponent(variantId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "idempotency-key": cryptoRandomKey() },
    body: JSON.stringify({ qty }),
  });
  return readCartFromResponse(res);
}

export async function removeCartLine(variantId: string): Promise<CartView> {
  const res = await cartFetch(`/v1/cart/items/${encodeURIComponent(variantId)}`, {
    method: "DELETE",
    headers: { "idempotency-key": cryptoRandomKey() },
  });
  return readCartFromResponse(res);
}

export async function checkoutConfirm(input: {
  cartId: string;
  customer: { name: string; phone: string; region: string };
}): Promise<OrderConfirmation> {
  // Deterministic per (cart, customer payload): if the user accidentally
  // double-submits the checkout form (slow network, refresh-then-submit),
  // the second call reuses the first call's key. The idempotency middleware
  // replays the first response, so the second submit lands the buyer on
  // the same order page instead of failing with "cart empty" after the
  // first call already drained it.
  const idemKey = await deterministicCheckoutKey(input.cartId, input.customer);
  const res = await fetch(`${API_URL}/v1/checkout/confirm`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": idemKey,
    },
    body: JSON.stringify({ cartId: input.cartId, customer: input.customer }),
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`checkout_${res.status}:${txt.slice(0, 200)}`);
  }
  const order = (await res.json()) as OrderConfirmation;
  // Cart is emptied server-side on confirm; drop the cookie so the next
  // add-to-cart starts fresh and the header badge clears immediately.
  await clearCartCookie();
  // Stash the access token so the buyer can revisit /order/<id> without a
  // query-string credential.
  const jar = await cookies();
  jar.set(`${ORDER_TOKEN_COOKIE_PREFIX}${order.orderId}`, order.orderToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ORDER_TOKEN_MAX_AGE_S,
  });
  return order;
}

export interface OrderViewLine {
  variantId: string;
  sellerId: string;
  qty: number;
  unitPriceMinor: string;
  productId: string | null;
  title: string | null;
  sku: string | null;
  heroImageUrl: string | null;
}

export interface OrderView {
  orderId: string;
  publicNumber: string;
  status: string;
  currency: string;
  totals: { subtotalMinor: string; shippingMinor: string; taxMinor: string; totalMinor: string };
  lines: OrderViewLine[];
  customer: { name: string; phone: string; region: string } | null;
  ownerKind: "user" | "anonymous";
  createdAt: string;
}

export async function getOrder(orderId: string): Promise<OrderView | null> {
  const jar = await cookies();
  const token = jar.get(`${ORDER_TOKEN_COOKIE_PREFIX}${orderId}`)?.value;
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers["x-mp-order-token"] = token;
  const res = await fetch(`${API_URL}/v1/orders/${encodeURIComponent(orderId)}`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`order_api_${res.status}`);
  return (await res.json()) as OrderView;
}

function cryptoRandomKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Stable idempotency key for /v1/checkout/confirm. Hashing (rather than
// concatenating raw fields) keeps phone/name out of the key sent on the wire.
// Exported for unit tests — not part of the public lib surface.
export async function deterministicCheckoutKey(
  cartId: string,
  customer: { name: string; phone: string; region: string },
): Promise<string> {
  const seed = `${cartId}\x1f${customer.name.trim()}\x1f${customer.phone.trim()}\x1f${customer.region.trim()}`;
  if (typeof crypto !== "undefined" && "subtle" in crypto) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Cold fallback — server runtime always has WebCrypto, but keep the wire
  // shape consistent if it ever isn't there.
  return `web-${cartId}-${seed.length}`;
}
