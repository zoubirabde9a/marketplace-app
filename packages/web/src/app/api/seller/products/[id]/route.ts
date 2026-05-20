// PATCH /api/seller/products/:id — proxy a field update to the API. The
// dashboard's edit page calls this when the seller saves changes to title,
// description, brand, category, or variants. Media adds/removes go through
// /api/seller/products/:id/media (different route) so we don't accidentally
// stomp media rows here.

import { NextResponse } from "next/server";
import { getSessionJwt } from "@/lib/sellerSession";
import { updateProduct, deleteProduct, type ApiError, type UpdateProductInput } from "@/lib/api";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const jwt = await getSessionJwt();
  if (!jwt) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  const { id } = await ctx.params;
  let body: UpdateProductInput;
  try {
    body = (await req.json()) as UpdateProductInput;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  try {
    const product = await updateProduct(jwt, id, body);
    return NextResponse.json({ ok: true, product });
  } catch (e) {
    const err = e as ApiError;
    console.error("[api/seller/products/:id] update_failed", err.status, err.message);
    return NextResponse.json(
      { ok: false, error: err.message || "update_failed", detail: err.detail },
      { status: err.status ?? 500 },
    );
  }
}

// DELETE /api/seller/products/:id — proxy soft-delete to the API. The
// dashboard surfaces this from the edit page's "Danger zone" with a
// type-the-title confirmation modal, so by the time we land here the
// seller has already confirmed intent.
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const jwt = await getSessionJwt();
  if (!jwt) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    await deleteProduct(jwt, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as ApiError;
    console.error("[api/seller/products/:id] delete_failed", err.status, err.message);
    return NextResponse.json(
      { ok: false, error: err.message || "delete_failed", detail: err.detail },
      { status: err.status ?? 500 },
    );
  }
}
