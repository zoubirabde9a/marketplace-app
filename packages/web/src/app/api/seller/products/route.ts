// POST /api/seller/products — create a new product on behalf of the
// signed-in seller. Forwards to POST /v1/products with the session JWT.

import { NextResponse } from "next/server";
import { getSessionJwt } from "@/lib/sellerSession";
import { createProduct, type ApiError, type CreateProductInput } from "@/lib/api";

export async function POST(req: Request): Promise<Response> {
  const jwt = await getSessionJwt();
  if (!jwt) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  let body: Partial<CreateProductInput>;
  try {
    body = (await req.json()) as Partial<CreateProductInput>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (
    typeof body.sellerId !== "string" ||
    typeof body.title !== "string" ||
    !Array.isArray(body.variants) ||
    body.variants.length === 0
  ) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }
  try {
    const product = await createProduct(jwt, body as CreateProductInput);
    return NextResponse.json({ ok: true, product });
  } catch (e) {
    const err = e as ApiError;
    return NextResponse.json(
      { ok: false, error: err.message || "create_failed", detail: err.detail },
      { status: err.status ?? 500 },
    );
  }
}
