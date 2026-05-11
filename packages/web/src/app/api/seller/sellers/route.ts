// POST /api/seller/sellers — create a seller profile for the signed-in user.
// Reads the session JWT from the httpOnly cookie and forwards to the API.

import { NextResponse } from "next/server";
import { getSessionJwt } from "@/lib/sellerSession";
import { createSeller, type ApiError } from "@/lib/api";

export async function POST(req: Request): Promise<Response> {
  const jwt = await getSessionJwt();
  if (!jwt) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  let body: {
    displayName?: unknown;
    phone?: unknown;
    countryCode?: unknown;
    whatsapp?: unknown;
    website?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.displayName !== "string" || body.displayName.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "display_name_required" }, { status: 400 });
  }
  // API now requires phone + countryCode (CreateSellerSchema in
  // packages/api/src/routes/sellers.ts). Surface a clear error here instead
  // of forwarding an incomplete payload that the API rejects with a raw
  // zod 400 — the BFF is the right place to translate the contract.
  if (typeof body.phone !== "string" || body.phone.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "phone_required" }, { status: 400 });
  }
  const countryCode =
    typeof body.countryCode === "string" && body.countryCode.trim().length === 2
      ? body.countryCode.trim().toUpperCase()
      : "DZ";
  try {
    const seller = await createSeller(jwt, {
      displayName: body.displayName.trim(),
      phone: body.phone.trim(),
      countryCode,
      ...(typeof body.whatsapp === "string" && body.whatsapp ? { whatsapp: body.whatsapp } : {}),
      ...(typeof body.website === "string" && body.website ? { website: body.website } : {}),
    });
    return NextResponse.json({ ok: true, seller });
  } catch (e) {
    const err = e as ApiError;
    return NextResponse.json(
      { ok: false, error: err.message || "create_failed", detail: err.detail },
      { status: err.status ?? 500 },
    );
  }
}
