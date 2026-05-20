import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder } from "@/lib/cart";
import { cleanProductTitle, formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // French-locale chrome for the buyer money path — matches /cart, /checkout,
  // and og:locale=fr_DZ. See anomaly [38]/[39].
  title: "Confirmation de commande",
  robots: { index: false, follow: false },
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id).catch(() => null);
  if (!order) notFound();

  // Match checkout-page wording: multi-seller orders produce one COD call per
  // seller, so the buyer needs to expect more than one phone call.
  const sellerCount = new Set(order.lines.map((l) => l.sellerId)).size;
  const codBlurb =
    sellerCount > 1
      ? `Chacun des ${sellerCount} vendeurs de cette commande vous appellera séparément pour confirmer avant l’expédition.`
      : "Le vendeur vous appellera pour confirmer avant l’expédition.";

  return (
    <section aria-labelledby="order-heading" className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-3xl mx-auto" lang="fr">
      <div className="rounded-2xl border border-ok/40 bg-ok/5 p-4 sm:p-6">
        <div aria-hidden className="text-xs uppercase tracking-widest text-ok font-semibold">Commande passée</div>
        <h1 id="order-heading" className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
          Commande #{order.publicNumber}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          {codBlurb} Gardez cette page ouverte ou prenez une capture d’écran — votre numéro de commande est{" "}
          <span dir="ltr" className="font-mono">{order.publicNumber}</span>.
        </p>
      </div>

      {order.customer && (
        <section aria-labelledby="order-contact-heading" className="mt-6 sm:mt-8 rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-6">
          <h2 id="order-contact-heading" className="text-xs uppercase tracking-widest text-ink-mute font-semibold">Contact de livraison</h2>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-ink-mute">Nom</dt>
              <dd className="mt-0.5" dir="auto">{order.customer.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-mute">Téléphone</dt>
              <dd className="mt-0.5 font-mono" dir="ltr">{order.customer.phone}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-mute">Wilaya</dt>
              <dd className="mt-0.5" dir="auto">{order.customer.region}</dd>
            </div>
          </dl>
        </section>
      )}

      <section aria-labelledby="order-articles-heading" className="mt-6 sm:mt-8 rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-6">
        <h2 id="order-articles-heading" className="text-xs uppercase tracking-widest text-ink-mute font-semibold">
          {order.lines.length === 1 ? "Article" : "Articles"} ({order.lines.length})
        </h2>
        <ul className="mt-3 divide-y divide-line-soft">
          {order.lines.map((l) => (
            <li key={l.variantId} className="py-3 flex items-start justify-between gap-3 sm:gap-4">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                {/* Thumbnail for visual recognition. Matches the seller-side
                    dashboard order lines so the buyer/seller see the same
                    visual cue. */}
                {l.heroImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.heroImageUrl}
                    alt=""
                    className="w-12 h-12 rounded object-cover border border-line-soft bg-bg shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <span aria-hidden className="w-12 h-12 rounded border border-line-soft bg-bg-elev shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  {l.productId ? (
                    <Link href={`/product/${encodeURIComponent(l.productId)}`} dir="auto" className="text-sm text-ink hover:text-accent active:text-accent untrusted break-words">
                      {l.title ? cleanProductTitle(l.title) : (l.sku ?? l.variantId)}
                    </Link>
                  ) : (
                    <span className="text-sm text-ink-soft break-words">{l.sku ?? l.variantId}</span>
                  )}
                  {/* SKU subtitle — buyers needing to reference an exact
                      variant later (warranty, returns, follow-up call to
                      seller) have the canonical identifier visible. Only
                      shown when both title + SKU exist (no double-render
                      when the title fallback already used the SKU). */}
                  {l.title && l.sku && (
                    <div className="text-[10px] text-ink-mute mt-0.5 font-mono truncate">{l.sku}</div>
                  )}
                  <div className="text-xs text-ink-mute mt-0.5 tabular-nums">
                    × {l.qty} · {formatPrice(l.unitPriceMinor, order.currency, "fr-DZ")} l’unité
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-sm font-medium tabular-nums">
                {formatPrice((BigInt(l.unitPriceMinor) * BigInt(l.qty)).toString(), order.currency, "fr-DZ")}
              </div>
            </li>
          ))}
        </ul>
        <dl className="mt-4 pt-4 border-t border-line-soft space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Sous-total</dt>
            <dd className="tabular-nums">{formatPrice(order.totals.subtotalMinor, order.currency, "fr-DZ")}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-0">
            <dt className="text-ink-soft">Livraison</dt>
            <dd className="text-ink-mute text-right">
              {BigInt(order.totals.shippingMinor) > 0n
                ? formatPrice(order.totals.shippingMinor, order.currency, "fr-DZ")
                : "Gratuite (paiement à la livraison)"}
            </dd>
          </div>
          {BigInt(order.totals.taxMinor) > 0n && (
            <div className="flex justify-between">
              <dt className="text-ink-soft">TVA</dt>
              <dd className="tabular-nums">{formatPrice(order.totals.taxMinor, order.currency, "fr-DZ")}</dd>
            </div>
          )}
        </dl>
        {/* Grand total uses a separate dl + stronger styling so it
            visually stands apart from the subtotal/shipping/tax row
            above, while keeping the dt/dd semantic that screen-reader
            users expect for label/value pairs. */}
        <dl className="mt-3 pt-3 border-t border-line-soft flex justify-between text-base font-medium">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatPrice(order.totals.totalMinor, order.currency, "fr-DZ")}</dd>
        </dl>
      </section>

      <div className="mt-6 sm:mt-8 flex gap-3">
        <Link
          href="/search"
          className="inline-flex items-center justify-center w-full sm:w-auto px-5 h-11 sm:h-10 rounded-md bg-accent text-bg text-sm font-medium hover:brightness-110 active:brightness-90 transition"
        >
          Continuer mes achats <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}
