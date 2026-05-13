// DELETE /api/seller/products/:id/media/:mediaId — detach an image from a
// product. The API refuses to delete the last image (would make the product
// invisible to the catalog filter); the dashboard surfaces that error.

import { NextResponse } from "next/server";
import { getSessionJwt } from "@/lib/sellerSession";
import { detachProductMedia, type ApiError } from "@/lib/api";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; mediaId: string }> },
): Promise<Response> {
  const jwt = await getSessionJwt();
  if (!jwt) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  const { id, mediaId } = await ctx.params;
  try {
    await detachProductMedia(jwt, id, mediaId);
    return new Response(null, { status: 204 });
  } catch (e) {
    const err = e as ApiError;
    console.error("[api/seller/products/:id/media/:mediaId] detach_failed", err.status, err.message);
    return NextResponse.json(
      { ok: false, error: err.message || "detach_failed", detail: err.detail },
      { status: err.status ?? 500 },
    );
  }
}
