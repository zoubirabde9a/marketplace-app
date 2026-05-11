"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { removeCartLine, updateCartQty } from "@/lib/cart";

export async function updateQtyAction(formData: FormData): Promise<void> {
  const variantId = String(formData.get("variantId") ?? "");
  const qty = Math.max(0, Math.min(99, Number(formData.get("qty") ?? 0)));
  if (!variantId) return;
  await updateCartQty(variantId, qty);
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

export async function goToCheckoutAction(): Promise<void> {
  redirect("/checkout");
}
