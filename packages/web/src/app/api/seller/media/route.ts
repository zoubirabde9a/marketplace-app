// POST /api/seller/media — proxy a single image upload from the seller
// dashboard to POST /v1/media on the API. The browser submits a multipart
// form-data body with the file under field "file"; we forward it through
// with the session JWT attached.
//
// We don't try to validate or rewrap the multipart body here — Next.js's
// streaming Request/Response semantics let us pass the raw body through to
// the upstream fetch. The API does the real validation (size, content type,
// auth) and we just relay its response shape.

import { NextResponse } from "next/server";
import { getSessionJwt } from "@/lib/sellerSession";

const API_URL = (process.env.MARKETPLACE_API_URL ?? "http://localhost:3100").replace(/\/$/, "");

export async function POST(req: Request): Promise<Response> {
  const jwt = await getSessionJwt();
  if (!jwt) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return NextResponse.json(
      { ok: false, error: "expected_multipart", detail: "Content-Type must be multipart/form-data." },
      { status: 415 },
    );
  }

  // Stream the body straight through. We read it into a Buffer because the
  // Node fetch we hand to the API doesn't take a ReadableStream body in this
  // runtime. The browser side caps file size at the picker; the API caps it
  // again at 10MB so a malicious client can't sneak by either.
  const ab = await req.arrayBuffer();
  const upstream = await fetch(`${API_URL}/v1/media`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      "content-type": contentType,
    },
    body: Buffer.from(ab),
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
