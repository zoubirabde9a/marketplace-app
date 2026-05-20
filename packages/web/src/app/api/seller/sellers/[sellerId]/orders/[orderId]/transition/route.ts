// POST /api/seller/sellers/:sellerId/orders/:orderId/transition — proxy a
// seller-driven order state transition to the API. The dashboard's order
// list calls this from a small client component when the seller hits
// "Marquer en préparation" / "Marquer expédié" / "Marquer livré" /
// "Annuler". Validates body shape lightly before forwarding (the API
// validates strictly with zod); we just need the discriminator to be one
// of the four exposed events.

import { NextResponse } from "next/server";
import { getSessionJwt } from "@/lib/sellerSession";
import { transitionSellerOrder, type ApiError, type SellerOrderEvent } from "@/lib/api";

const ALLOWED_EVENTS = new Set(["begin_fulfillment", "ship", "deliver", "cancel"]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ sellerId: string; orderId: string }> },
): Promise<Response> {
  const jwt = await getSessionJwt();
  if (!jwt) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  const { sellerId, orderId } = await ctx.params;
  let body: SellerOrderEvent;
  try {
    body = (await req.json()) as SellerOrderEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !ALLOWED_EVENTS.has((body as { event?: string }).event ?? "")) {
    return NextResponse.json({ ok: false, error: "invalid_event" }, { status: 400 });
  }
  if (body.event === "cancel" && (typeof body.reason !== "string" || body.reason.trim().length === 0)) {
    return NextResponse.json(
      { ok: false, error: "reason_required", detail: "Cancellation requires a reason." },
      { status: 400 },
    );
  }
  try {
    const result = await transitionSellerOrder(jwt, sellerId, orderId, body);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const err = e as ApiError;
    console.error(
      "[api/seller/orders/transition] transition_failed",
      err.status,
      err.message,
    );
    return NextResponse.json(
      { ok: false, error: err.message || "transition_failed", detail: err.detail },
      { status: err.status ?? 500 },
    );
  }
}
