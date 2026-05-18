import type { Metadata } from "next";
import Link from "next/link";
import { getCart } from "@/lib/cart";
import { cleanProductTitle, formatPrice } from "@/lib/format";
import { PendingButton } from "@/components/PendingButton";
import { adjustQtyAction, removeLineAction, updateQtyAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Cart/checkout chrome is in French to match og:locale=fr_DZ and the rest
  // of the buyer-facing site (header, footer, product detail). The path to
  // revenue can't be the only surface in English. See anomaly report [38].
  title: "Votre panier",
  robots: { index: false, follow: false },
};

export default async function CartPage() {
  const cart = await getCart().catch(() => null);
  const lines = cart?.lines ?? [];

  return (
    <section className="pt-6 sm:pt-10 pb-24 max-w-4xl mx-auto" lang="fr">
      <h1 className="text-3xl font-semibold tracking-tight">Votre panier</h1>

      {lines.length === 0 ? (
        <div className="mt-8 sm:mt-10 rounded-2xl border border-line-soft bg-bg-soft/60 p-6 sm:p-8 text-center">
          <p className="text-ink-soft">Votre panier est vide.</p>
          <Link
            href="/search"
            className="mt-4 inline-flex items-center justify-center px-5 h-11 sm:h-10 rounded-md bg-accent text-bg text-sm font-medium hover:brightness-110 active:brightness-90 transition"
          >
            Parcourir les produits
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
          <ul className="lg:col-span-2 divide-y divide-line-soft rounded-2xl border border-line-soft bg-bg-soft/60">
            {lines.map((l) => (
              <li key={l.variantId} className="flex gap-3 sm:gap-4 p-3 sm:p-4">
                <div className="shrink-0 w-20 h-20 rounded-lg bg-bg-elev overflow-hidden flex items-center justify-center">
                  {l.heroImageUrl ? (
                    // Use plain <img>: cart thumbnails are dynamic per-buyer
                    // and not worth burning a next/image optimisation slot.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={l.heroImageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="object-cover w-full h-full"
                    />
                  ) : (
                    <span className="text-ink-mute text-xs" aria-hidden>—</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {l.productId ? (
                    <Link
                      href={`/product/${encodeURIComponent(l.productId)}`}
                      className="text-sm font-medium text-ink hover:text-accent active:text-accent line-clamp-2 untrusted"
                    >
                      {l.title ? cleanProductTitle(l.title) : (l.sku ?? l.variantId)}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-ink-soft break-words">{l.sku ?? l.variantId}</span>
                  )}
                  {l.sku && (
                    <div className="text-xs text-ink-mute font-mono mt-0.5 truncate">{l.sku}</div>
                  )}
                  <div className="mt-2 text-sm">
                    {formatPrice(l.unitPriceMinor, cart!.currency)}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center rounded border border-line overflow-hidden">
                      <form action={adjustQtyAction}>
                        <input type="hidden" name="variantId" value={l.variantId} />
                        <input type="hidden" name="currentQty" value={l.qty} />
                        <input type="hidden" name="delta" value={-1} />
                        <PendingButton
                          ariaLabel="Diminuer la quantité"
                          className="w-10 h-10 sm:w-8 sm:h-8 text-base sm:text-sm text-ink-soft hover:bg-bg-elev active:bg-bg-elev disabled:opacity-30 transition"
                          disabled={l.qty <= 1}
                        >
                          −
                        </PendingButton>
                      </form>
                      <form action={updateQtyAction} className="contents">
                        <input type="hidden" name="variantId" value={l.variantId} />
                        <input
                          type="number"
                          name="qty"
                          defaultValue={l.qty}
                          min={0}
                          max={99}
                          inputMode="numeric"
                          enterKeyHint="done"
                          className="w-12 h-10 sm:h-8 bg-bg-elev text-base sm:text-sm text-center border-x border-line focus:outline-none focus:bg-bg-elev/60"
                          aria-label="Quantité"
                        />
                      </form>
                      <form action={adjustQtyAction}>
                        <input type="hidden" name="variantId" value={l.variantId} />
                        <input type="hidden" name="currentQty" value={l.qty} />
                        <input type="hidden" name="delta" value={1} />
                        <PendingButton
                          ariaLabel="Augmenter la quantité"
                          className="w-10 h-10 sm:w-8 sm:h-8 text-base sm:text-sm text-ink-soft hover:bg-bg-elev active:bg-bg-elev disabled:opacity-30 transition"
                          disabled={l.qty >= 99}
                        >
                          +
                        </PendingButton>
                      </form>
                    </div>
                    <form action={removeLineAction}>
                      <input type="hidden" name="variantId" value={l.variantId} />
                      <PendingButton className="h-10 sm:h-8 px-3.5 rounded border border-line text-sm sm:text-xs text-ink-mute hover:text-bad hover:border-bad/40 active:text-bad active:border-bad/40 transition disabled:opacity-60">
                        Retirer
                      </PendingButton>
                    </form>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-medium">
                    {formatPrice(
                      (BigInt(l.unitPriceMinor) * BigInt(l.qty)).toString(),
                      cart!.currency,
                    )}
                  </div>
                  <div className="text-xs text-ink-mute mt-1">× {l.qty}</div>
                </div>
              </li>
            ))}
          </ul>

          <aside className="rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-6 h-fit">
            <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold">Récapitulatif</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Sous-total</dt>
                <dd>{formatPrice(cart!.totals.subtotalMinor, cart!.currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Livraison</dt>
                <dd className="text-ink-mute">Gratuite (paiement à la livraison)</dd>
              </div>
            </dl>
            <div className="mt-4 pt-4 border-t border-line-soft flex justify-between text-base font-medium">
              <span>Total</span>
              <span>{formatPrice(cart!.totals.totalMinor, cart!.currency)}</span>
            </div>
            <Link
              href="/checkout"
              prefetch
              className="mt-6 w-full h-11 inline-flex items-center justify-center rounded-md bg-accent text-bg text-sm font-semibold hover:brightness-110 active:brightness-90 transition"
            >
              Commander
            </Link>
            <Link
              href="/search"
              className="mt-3 flex items-center justify-center h-9 text-sm sm:text-xs text-ink-mute hover:text-ink-soft active:text-ink-soft transition"
            >
              ← Continuer mes achats
            </Link>
            <p className="mt-4 text-xs text-ink-mute leading-relaxed">
              Paiement à la livraison. Votre numéro de téléphone et votre
              région de livraison vous seront demandés à l&rsquo;étape
              suivante.
            </p>
          </aside>
        </div>
      )}
    </section>
  );
}
