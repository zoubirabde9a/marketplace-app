// PATCH /api/seller/products/:id/stock — flip the first variant's inStock.
//
// The marketplace API's PATCH /v1/products/:id requires the full variants
// array (sku + priceMinor + currency + inStock; partial entries get
// dropped). The seller dashboard only has aggregated inStock per product,
// not full variant data, so a single-shot stock toggle from the row would
// otherwise need the client to fetch the detail itself.
//
// Doing the read-modify-write here means the client just sends
// `{ inStock: boolean }` and we hide the round-trip. The route mirrors the
// edit-form's "only first variant is editable from the dashboard"
// semantics: when a product has multiple variants the seller is told to
// use the edit page, but the API itself only mutates v0 either way, so
// even if this route is called on a multi-variant product we don't
// accidentally take siblings out of stock.

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
  let body: { inStock?: unknown };
  try {
    body = (await req.json()) as { inStock?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.inStock !== "boolean") {
    return NextResponse.json({ ok: false, error: "inStock_required" }, { status: 400 });
  }
  const desired = body.inStock;
  const current = await getProduct(id);
  if (!current) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (current.variants.length === 0) {
    // Should never happen — the API guarantees at least one variant per
    // product at create time — but the array-index access below would
    // throw otherwise, so handle defensively.
    return NextResponse.json({ ok: false, error: "no_variants" }, { status: 409 });
  }
  // Preserve siblings; only flip the first variant. Caller is expected to
  // disable this surface for multi-variant products (see dashboard row).
  const variants = current.variants.map((v, i) => ({
    sku: v.sku,
    priceMinor: v.priceMinor,
    currency: v.currency,
    inStock: i === 0 ? desired : v.inStock,
  }));
  try {
    await updateProduct(jwt, id, { variants });
    return NextResponse.json({ ok: true, inStock: desired });
  } catch (e) {
    const err = e as ApiError;
    console.error("[api/seller/products/:id/stock] update_failed", err.status, err.message);
    return NextResponse.json(
      { ok: false, error: err.message || "update_failed", detail: err.detail },
      { status: err.status ?? 500 },
    );
  }
}
