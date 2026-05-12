"use server";

import { revalidatePath } from "next/cache";
import { removeCartLine, updateCartQty } from "@/lib/cart";

const MAX_QTY = 99;

// Cart-mutation actions can fail for benign reasons that should NOT crash
// the buyer to the global error boundary:
//   - cart was server-side cleaned up between page render and click (deploy,
//     DB rotation), so the variant we're updating no longer exists
//   - API briefly unavailable
// In both cases, the right buyer-facing outcome is "cart page re-renders
// with whatever the current truth is" — usually an empty state, which the
// page already handles gracefully. Crashing to error.tsx is worse than
// silently dropping the click and refreshing the view.
function refreshCart(): void {
  revalidatePath("/", "layout");
  revalidatePath("/cart");
}

function logActionError(action: string, err: unknown): void {
  if (typeof console !== "undefined") {
    console.error(`[cart] ${action}_failed`, (err as Error).message);
  }
}

export async function updateQtyAction(formData: FormData): Promise<void> {
  const variantId = String(formData.get("variantId") ?? "");
  const qty = Math.max(0, Math.min(MAX_QTY, Number(formData.get("qty") ?? 0)));
  if (!variantId) return;
  try {
    await updateCartQty(variantId, qty);
  } catch (e) {
    logActionError("update_qty", e);
  }
  refreshCart();
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
  try {
    await updateCartQty(variantId, next);
  } catch (e) {
    logActionError("adjust_qty", e);
  }
  refreshCart();
}

export async function removeLineAction(formData: FormData): Promise<void> {
  const variantId = String(formData.get("variantId") ?? "");
  if (!variantId) return;
  try {
    await removeCartLine(variantId);
  } catch (e) {
    logActionError("remove_line", e);
  }
  refreshCart();
}

