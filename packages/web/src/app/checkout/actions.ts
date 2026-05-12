"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkoutConfirm } from "@/lib/cart";

// Persist the buyer's delivery contact (anonymous COD orders only — the API
// already handles user-bound orders separately) so a repeat customer doesn't
// re-type name / phone / wilaya on every purchase. 1-year cookie, lax, secure
// in prod. No PII beyond what they just typed into a public form.
const BUYER_COOKIE = "mp_buyer_info";
const BUYER_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

export async function placeOrderAction(formData: FormData): Promise<void> {
  const cartId = String(formData.get("cartId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim();

  if (!cartId || !name || !phone || !region) {
    redirect("/checkout?err=missing");
  }

  let orderId: string;
  try {
    const order = await checkoutConfirm({
      cartId,
      customer: { name, phone, region },
    });
    orderId = order.orderId;
  } catch (e) {
    // Log the technical error server-side but redirect the buyer with a
    // clean `failed` flag — the previous code URL-encoded the raw exception
    // message into `?err=…`, which leaked internals into browser history
    // (and shareable URLs) while the renderer only special-cases `missing`
    // anyway and falls back to a generic message for anything else.
    if (typeof console !== "undefined") {
      console.error("[checkout] place_order_failed", (e as Error).message);
    }
    redirect(`/checkout?err=failed`);
  }
  const jar = await cookies();
  jar.set(BUYER_COOKIE, JSON.stringify({ name, phone, region }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: BUYER_COOKIE_MAX_AGE_S,
  });
  revalidatePath("/", "layout");
  redirect(`/order/${encodeURIComponent(orderId)}`);
}

export async function readSavedBuyerInfo(): Promise<{ name: string; phone: string; region: string } | null> {
  const jar = await cookies();
  const raw = jar.get(BUYER_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { name?: unknown; phone?: unknown; region?: unknown };
    if (typeof parsed.name === "string" && typeof parsed.phone === "string" && typeof parsed.region === "string") {
      return { name: parsed.name, phone: parsed.phone, region: parsed.region };
    }
  } catch {}
  return null;
}
