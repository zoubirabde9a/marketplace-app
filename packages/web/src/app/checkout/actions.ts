"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkoutConfirm } from "@/lib/cart";

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
    const msg = encodeURIComponent((e as Error).message.slice(0, 80));
    redirect(`/checkout?err=${msg}`);
  }
  revalidatePath("/", "layout");
  redirect(`/order/${encodeURIComponent(orderId)}`);
}
