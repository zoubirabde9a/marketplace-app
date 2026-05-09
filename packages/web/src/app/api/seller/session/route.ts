// POST /api/seller/session
//   Body: { idToken: string }
//   Exchanges a Google ID token for a marketplace session JWT (via the API)
//   and stores it in an httpOnly cookie. Returns { ok: true } on success or
//   { ok: false, error } on failure.
//
// DELETE /api/seller/session
//   Clears the cookie (logout).

import { NextResponse } from "next/server";
import { loginWithGoogle, type ApiError } from "@/lib/api";

// Aliased here for backwards compatibility — the seller GoogleSignInButton
// historically hit this endpoint. New callers should use /api/auth/session
// directly (this route may be removed once the seller dashboard is migrated).
const COOKIE_NAME = "mp_session";

export async function POST(req: Request): Promise<Response> {
  let body: { idToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.idToken !== "string" || body.idToken.length === 0) {
    return NextResponse.json({ ok: false, error: "missing_id_token" }, { status: 400 });
  }
  try {
    const { sessionJwt, expiresIn } = await loginWithGoogle(body.idToken);
    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: COOKIE_NAME,
      value: sessionJwt,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: expiresIn,
    });
    return res;
  } catch (e) {
    const err = e as ApiError;
    return NextResponse.json(
      { ok: false, error: err.message || "login_failed", detail: err.detail },
      { status: err.status ?? 500 },
    );
  }
}

export async function DELETE(): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  // Mirror the attributes used when setting the cookie so the browser
  // unambiguously matches and overwrites it.
  res.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
