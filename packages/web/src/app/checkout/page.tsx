import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCart } from "@/lib/cart";
import { cleanProductTitle, formatPrice } from "@/lib/format";
import { ALGERIAN_WILAYAS } from "./wilayas";
import { placeOrderAction, readSavedBuyerInfo } from "./actions";
import { PlaceOrderSubmit } from "./PlaceOrderSubmit";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // French-locale chrome for the buyer money path — matches /cart and the
  // rest of og:locale=fr_DZ surfaces. See anomaly [38]/[39].
  title: "Commande",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const cart = await getCart().catch(() => null);
  if (!cart || cart.lines.length === 0) {
    redirect("/cart");
  }
  const savedBuyer = await readSavedBuyerInfo();
  const params = await searchParams;
  const errCode = params.err;
  const errLabel = !errCode
    ? null
    : errCode === "missing"
      ? "Veuillez renseigner votre nom, téléphone et région."
      : "Désolé, une erreur est survenue lors de la commande. Veuillez réessayer.";
  // Multi-seller carts produce one COD call per seller — saying "the seller"
  // in the singular sets the wrong expectation and surprises buyers when the
  // second call comes in. Count distinct sellers and tweak the copy.
  const sellerCount = new Set(cart.lines.map((l) => l.sellerId)).size;
  const codBlurb =
    sellerCount > 1
      ? `Paiement à la livraison. Chacun des ${sellerCount} vendeurs de cette commande vous appellera séparément pour confirmer avant l’expédition.`
      : "Paiement à la livraison. Le vendeur vous appellera pour confirmer avant l’expédition.";

  return (
    <section aria-labelledby="checkout-heading" className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-3xl mx-auto" lang="fr">
      <Link href="/cart" className="inline-flex items-center h-8 text-sm sm:text-xs text-ink-mute hover:text-ink-soft active:text-ink-soft">
        ← Retour au panier
      </Link>
      <h1 id="checkout-heading" className="mt-3 text-3xl font-semibold tracking-tight">Commande</h1>
      <p className="mt-2 text-sm text-ink-soft">{codBlurb}</p>

      {errLabel && (
        <div className="mt-6 rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          {errLabel}
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <form action={placeOrderAction} className="lg:col-span-2 space-y-4">
          <input type="hidden" name="cartId" value={cart.cartId} />
          <div>
            <label htmlFor="name" className="block text-xs uppercase tracking-widest text-ink-mute font-semibold mb-1">
              Nom complet
            </label>
            <input
              id="name"
              name="name"
              required
              maxLength={120}
              autoComplete="name"
              defaultValue={savedBuyer?.name ?? ""}
              className="w-full h-11 px-3 rounded-md border border-line bg-bg-elev text-base sm:text-sm"
            />
          </div>
          <div>
            <label htmlFor="phone" className="block text-xs uppercase tracking-widest text-ink-mute font-semibold mb-1">
              Téléphone (le vendeur appellera ce numéro)
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              required
              inputMode="tel"
              maxLength={32}
              autoComplete="tel"
              placeholder="0555 12 34 56"
              defaultValue={savedBuyer?.phone ?? ""}
              className="w-full h-11 px-3 rounded-md border border-line bg-bg-elev text-base sm:text-sm font-mono"
            />
          </div>
          <div>
            <label htmlFor="region" className="block text-xs uppercase tracking-widest text-ink-mute font-semibold mb-1">
              Région de livraison (wilaya)
            </label>
            <select
              id="region"
              name="region"
              required
              defaultValue={savedBuyer?.region && ALGERIAN_WILAYAS.includes(savedBuyer.region) ? savedBuyer.region : ""}
              className="w-full h-11 px-3 rounded-md border border-line bg-bg-elev text-base sm:text-sm"
            >
              <option value="" disabled>
                Sélectionnez une wilaya…
              </option>
              {ALGERIAN_WILAYAS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>

          <PlaceOrderSubmit />
        </form>

        <aside className="rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-6 h-fit">
          <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold">Récapitulatif de commande</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {cart.lines.map((l) => (
              <li key={l.variantId} className="flex justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate untrusted">{l.title ? cleanProductTitle(l.title) : (l.sku ?? l.variantId)}</div>
                  <div className="text-xs text-ink-mute tabular-nums">× {l.qty}</div>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  {formatPrice(
                    (BigInt(l.unitPriceMinor) * BigInt(l.qty)).toString(),
                    cart.currency,
                    "fr-DZ",
                  )}
                </div>
              </li>
            ))}
          </ul>
          <dl className="mt-4 pt-4 border-t border-line-soft flex justify-between text-base font-medium">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatPrice(cart.totals.totalMinor, cart.currency, "fr-DZ")}</dd>
          </dl>
          <p className="mt-3 text-xs text-ink-mute">Livraison : gratuite (paiement à la livraison).</p>
        </aside>
      </div>
    </section>
  );
}
