// PATCH /api/seller/sellers/:id — update contact info on a seller.
// Forwards the patch (phone/whatsapp/website) to the API using the session
// JWT from the httpOnly cookie.

import { NextResponse } from "next/server";
import { getSessionJwt } from "@/lib/sellerSession";
import { updateSellerContact, type ApiError } from "@/lib/api";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const jwt = await getSessionJwt();
  if (!jwt) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  const { id } = await ctx.params;
  let body: { phone?: unknown; whatsapp?: unknown; website?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const patch: { phone?: string | null; whatsapp?: string | null; website?: string | null } = {};
  for (const k of ["phone", "whatsapp", "website"] as const) {
    const v = body[k];
    if (v === null) patch[k] = null;
    else if (typeof v === "string") patch[k] = v;
  }
  try {
    const seller = await updateSellerContact(jwt, id, patch);
    return NextResponse.json({ ok: true, seller });
  } catch (e) {
    const err = e as ApiError;
    return NextResponse.json(
      { ok: false, error: err.message || "update_failed", detail: err.detail },
      { status: err.status ?? 500 },
    );
  }
}
