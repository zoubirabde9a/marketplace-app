// POST /api/seller/products/:id/media — attach an uploaded media URL to a
// product. The upload itself happens at POST /api/seller/media (which
// returns the URL); this just records it in the database.

import { NextResponse } from "next/server";
import { getSessionJwt } from "@/lib/sellerSession";
import { attachProductMedia, type ApiError, type MediaInput } from "@/lib/api";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const jwt = await getSessionJwt();
  if (!jwt) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  const { id } = await ctx.params;
  let body: MediaInput;
  try {
    body = (await req.json()) as MediaInput;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.url !== "string" || typeof body.contentType !== "string") {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }
  try {
    const media = await attachProductMedia(jwt, id, body);
    return NextResponse.json({ ok: true, media });
  } catch (e) {
    const err = e as ApiError;
    console.error("[api/seller/products/:id/media] attach_failed", err.status, err.message);
    return NextResponse.json(
      { ok: false, error: err.message || "attach_failed", detail: err.detail },
      { status: err.status ?? 500 },
    );
  }
}
