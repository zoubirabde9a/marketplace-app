// POST   /api/auth/session  { idToken }
//   Exchanges a Google ID token for a marketplace session JWT (via the API)
//   and stores it as an httpOnly cookie. Returns { ok: true } on success.
//
// DELETE /api/auth/session
//   Clears the cookie (logout).
//
// This is the unified buyer + seller session endpoint. The single cookie
// `mp_session` carries the same Ed25519-signed JWT for every authenticated
// surface — observer pages, seller dashboard, /v1/auth/me, etc.

import { NextResponse } from "next/server";
import { loginWithGoogle, type ApiError } from "@/lib/api";

export const SESSION_COOKIE = "mp_session";

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
      name: SESSION_COOKIE,
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
  // unambiguously matches and overwrites it; otherwise some browsers treat
  // the deletion cookie as a separate cookie and the original survives.
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
