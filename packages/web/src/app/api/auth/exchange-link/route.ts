// POST /api/auth/exchange-link  { code }
//   Exchanges an agent-issued one-time login code for a marketplace session
//   JWT (via the API's POST /v1/auth/exchange-link) and stores it as an
//   httpOnly cookie. Same cookie shape as POST /api/auth/session.
//
// This is the second half of the "agent gives my human a login link" flow.
// First half is POST /v1/auth/login-link on the API, which a passport-bearing
// agent calls to mint the URL it sends to the human.

import { NextResponse } from "next/server";
import { exchangeAgentLink, type ApiError } from "@/lib/api";
import { SESSION_COOKIE } from "../session/route";

export async function POST(req: Request): Promise<Response> {
  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.code !== "string" || body.code.length === 0) {
    return NextResponse.json({ ok: false, error: "missing_code" }, { status: 400 });
  }
  try {
    const { sessionJwt, expiresIn } = await exchangeAgentLink(body.code);
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
    console.error("[api/auth/exchange-link] exchange_failed", err.status, err.message);
    return NextResponse.json(
      { ok: false, error: err.message || "exchange_failed", detail: err.detail },
      { status: err.status ?? 500 },
    );
  }
}
