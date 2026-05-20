// PATCH /api/seller/products/:id/price — update the first variant's
// priceMinor without round-tripping to the edit page. Same read-modify-
// write shape as the stock-toggle proxy (c4cacf7): the API's PATCH
// /v1/products/:id requires the full variants array, so we fetch
// current state here and the client only needs to send the new price.
//
// Accepts the price as a "major" decimal string ("29999.50") so the
// client UX matches the edit form and the seller doesn't have to think
// in cents. We multiply to minor server-side; that puts the
// floating-point math in one place instead of scattering it across the
// client. The conversion is integer-only (split on the decimal) so
// it's deterministic across browsers and unaffected by locale.

import { NextResponse } from "next/server";
import { getSessionJwt } from "@/lib/sellerSession";
import { getProduct, updateProduct, type ApiError } from "@/lib/api";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const jwt = await getSessionJwt();
  if (!jwt) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  const { id } = await ctx.params;
  let body: { priceMajor?: unknown };
  try {
    body = (await req.json()) as { priceMajor?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const raw = typeof body.priceMajor === "string" ? body.priceMajor.trim() : "";
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_price",
        detail: "Le prix doit être un nombre positif avec au plus 2 décimales.",
      },
      { status: 400 },
    );
  }
  const [wholeRaw, fracRaw = ""] = raw.split(".");
  // priceMinor = whole * 100 + frac (padded to 2 digits). String concat
  // avoids the parseInt/floating-point trap that would let "0.30" round
  // to 29 cents. The leading-zero strip ("0042" → "42") keeps the API's
  // strict-positive bigint validation happy.
  const priceMinor = `${wholeRaw}${fracRaw.padEnd(2, "0").slice(0, 2)}`.replace(/^0+(?=\d)/, "");
  if (priceMinor === "0" || priceMinor === "") {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_price",
        detail: "Le prix doit être strictement positif.",
      },
      { status: 400 },
    );
  }

  const current = await getProduct(id);
  if (!current) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (current.variants.length === 0) {
    return NextResponse.json({ ok: false, error: "no_variants" }, { status: 409 });
  }
  // Update only the first variant's price; multi-variant pricing is
  // out of scope for the inline editor (the dashboard guards on
  // variantCount <= 1 before showing it). Other variants' fields are
  // preserved verbatim, same as the stock proxy.
  const variants = current.variants.map((v, i) => ({
    sku: v.sku,
    priceMinor: i === 0 ? priceMinor : v.priceMinor,
    currency: v.currency,
    inStock: v.inStock,
  }));
  try {
    await updateProduct(jwt, id, { variants });
    return NextResponse.json({ ok: true, priceMinor });
  } catch (e) {
    const err = e as ApiError;
    console.error("[api/seller/products/:id/price] update_failed", err.status, err.message);
    return NextResponse.json(
      { ok: false, error: err.message || "update_failed", detail: err.detail },
      { status: err.status ?? 500 },
    );
  }
}
