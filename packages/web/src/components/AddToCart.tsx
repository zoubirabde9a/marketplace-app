// Server-action add-to-cart button. Submits a plain form so it works without
// client JS — the form action calls the marketplace API on the server, sets
// the cart cookie, and redirects to /cart.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addToCart } from "@/lib/cart";

// Whitelist of post-add destinations. Anything else (including protocol-
// relative `//evil.com`, absolute `https://...`, or a back-navigation `..`)
// falls back to /cart. Defense-in-depth: Next server actions already require
// same-origin POSTs, but a same-origin form could still pass a hostile value
// here. Keeping the set small and explicit means open-redirect mistakes can't
// sneak in via a future call site.
const ALLOWED_REDIRECTS = new Set(["/cart", "/checkout"]);

async function addAction(formData: FormData): Promise<void> {
  "use server";
  const variantId = String(formData.get("variantId") ?? "");
  const qty = Math.max(1, Math.min(99, Number(formData.get("qty") ?? 1)));
  const requested = String(formData.get("redirectTo") ?? "/cart");
  const redirectTo = ALLOWED_REDIRECTS.has(requested) ? requested : "/cart";
  if (!variantId) throw new Error("missing_variant");
  await addToCart(variantId, qty);
  // Header cart badge is rendered on every layout — bust the layout cache so
  // the count updates immediately after the redirect lands on /cart.
  revalidatePath("/", "layout");
  redirect(redirectTo);
}

export function AddToCart({
  variantId,
  inStock,
  // French default to match og:locale=fr_DZ. Callers (product card / detail /
  // "Buy now" CTA on /product/[id]) can still override per surface — see
  // [38]–[41] for the locale rationale and i18n audit.
  label = "Ajouter au panier",
  redirectTo = "/cart",
  className,
}: {
  variantId: string;
  inStock: boolean;
  label?: string;
  redirectTo?: string;
  className?: string;
}) {
  return (
    <form action={addAction} className={className}>
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="qty" value="1" />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <button
        type="submit"
        disabled={!inStock}
        className="inline-flex items-center justify-center h-10 px-5 rounded-md bg-accent text-bg text-sm font-medium hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        {inStock ? label : "Rupture de stock"}
      </button>
    </form>
  );
}
