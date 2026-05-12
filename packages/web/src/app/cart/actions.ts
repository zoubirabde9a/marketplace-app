"use server";

import { revalidatePath } from "next/cache";
import { removeCartLine, updateCartQty } from "@/lib/cart";

const MAX_QTY = 99;

export async function updateQtyAction(formData: FormData): Promise<void> {
  const variantId = String(formData.get("variantId") ?? "");
  const qty = Math.max(0, Math.min(MAX_QTY, Number(formData.get("qty") ?? 0)));
  if (!variantId) return;
  await updateCartQty(variantId, qty);
  revalidatePath("/", "layout");
  revalidatePath("/cart");
}

// +/− buttons on each cart row. We carry the row's current qty in a hidden
// field and apply delta server-side; submitting from a plain form keeps the
// page working without client JS. `qty=0` removes the line.
export async function adjustQtyAction(formData: FormData): Promise<void> {
  const variantId = String(formData.get("variantId") ?? "");
  const current = Math.max(0, Math.floor(Number(formData.get("currentQty") ?? 0)));
  const delta = Math.trunc(Number(formData.get("delta") ?? 0));
  if (!variantId || !Number.isFinite(delta) || delta === 0) return;
  const next = Math.max(0, Math.min(MAX_QTY, current + delta));
  if (next === current) return;
  await updateCartQty(variantId, next);
  revalidatePath("/", "layout");
  revalidatePath("/cart");
}

export async function removeLineAction(formData: FormData): Promise<void> {
  const variantId = String(formData.get("variantId") ?? "");
  if (!variantId) return;
  await removeCartLine(variantId);
  revalidatePath("/", "layout");
  revalidatePath("/cart");
}

