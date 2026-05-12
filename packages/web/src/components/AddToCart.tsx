// Server-action add-to-cart button. Submits a plain form so it works without
// client JS — the form action calls the marketplace API on the server, sets
// the cart cookie, and redirects to /cart.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addToCart } from "@/lib/cart";
import { AddToCartSubmit } from "./AddToCartSubmit";

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
  // The "Buy now" caller redirects to /checkout, so the in-flight verbiage
  // should match the user's intent ("Achat en cours…", not "Ajout en cours…"
  // which would tell them they just landed an item in the cart).
  const pendingLabel = redirectTo === "/checkout" ? "Achat en cours…" : "Ajout en cours…";
  return (
    <form action={addAction} className={className}>
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="qty" value="1" />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      {/* Client-side submit button reads useFormStatus() so we can disable
          + relabel while the server action is in flight. Before this, a slow
          add-to-cart (Algerian mobile network) gave the buyer zero feedback
          for the seconds between click and redirect — a real "did it click?"
          smell that caused duplicate adds. The no-JS fallback still works:
          when JS is off, AddToCartSubmit hydrates as a regular <button>. */}
      <AddToCartSubmit inStock={inStock} label={label} pendingLabel={pendingLabel} />
    </form>
  );
}
