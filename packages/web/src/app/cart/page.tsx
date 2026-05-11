import type { Metadata } from "next";
import Link from "next/link";
import { getCart } from "@/lib/cart";
import { formatPrice } from "@/lib/format";
import { goToCheckoutAction, removeLineAction, updateQtyAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false, follow: false },
};

export default async function CartPage() {
  const cart = await getCart().catch(() => null);
  const lines = cart?.lines ?? [];

  return (
    <section className="pt-10 pb-24 max-w-4xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Your cart</h1>

      {lines.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-line-soft bg-bg-soft/60 p-8 text-center">
          <p className="text-ink-soft">Your cart is empty.</p>
          <Link
            href="/search"
            className="mt-4 inline-flex items-center px-4 py-2 rounded-md bg-accent text-bg text-sm font-medium hover:brightness-110 transition"
          >
            Browse products
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
          <ul className="lg:col-span-2 divide-y divide-line-soft rounded-2xl border border-line-soft bg-bg-soft/60">
            {lines.map((l) => (
              <li key={l.variantId} className="flex gap-4 p-4">
                <div className="shrink-0 w-20 h-20 rounded-lg bg-bg-elev overflow-hidden flex items-center justify-center">
                  {l.heroImageUrl ? (
                    // Use plain <img>: cart thumbnails are dynamic per-buyer
                    // and not worth burning a next/image optimisation slot.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.heroImageUrl} alt="" className="object-cover w-full h-full" />
                  ) : (
                    <span className="text-ink-mute text-xs" aria-hidden>—</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {l.productId ? (
                    <Link
                      href={`/product/${encodeURIComponent(l.productId)}`}
                      className="text-sm font-medium text-ink hover:text-accent line-clamp-2 untrusted"
                    >
                      {l.title ?? l.sku ?? l.variantId}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-ink-soft">{l.sku ?? l.variantId}</span>
                  )}
                  {l.sku && (
                    <div className="text-xs text-ink-mute font-mono mt-0.5">{l.sku}</div>
                  )}
                  <div className="mt-2 text-sm">
                    {formatPrice(l.unitPriceMinor, cart!.currency)}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <form action={updateQtyAction} className="flex items-center">
                      <input type="hidden" name="variantId" value={l.variantId} />
                      <input
                        type="number"
                        name="qty"
                        defaultValue={l.qty}
                        min={0}
                        max={99}
                        className="w-16 h-8 px-2 rounded border border-line bg-bg-elev text-sm text-center"
                        aria-label="Quantity"
                      />
                      <button
                        type="submit"
                        className="ml-2 h-8 px-3 rounded border border-line text-xs text-ink-soft hover:text-ink hover:border-accent/40 transition"
                      >
                        Update
                      </button>
                    </form>
                    <form action={removeLineAction}>
                      <input type="hidden" name="variantId" value={l.variantId} />
                      <button
                        type="submit"
                        className="h-8 px-3 rounded border border-line text-xs text-ink-mute hover:text-bad hover:border-bad/40 transition"
                      >
                        Remove
                      </button>
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

          <aside className="rounded-2xl border border-line-soft bg-bg-soft/60 p-6 h-fit">
            <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold">Summary</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Subtotal</dt>
                <dd>{formatPrice(cart!.totals.subtotalMinor, cart!.currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Delivery</dt>
                <dd className="text-ink-mute">Calculated at checkout</dd>
              </div>
            </dl>
            <div className="mt-4 pt-4 border-t border-line-soft flex justify-between text-base font-medium">
              <span>Total</span>
              <span>{formatPrice(cart!.totals.subtotalMinor, cart!.currency)}</span>
            </div>
            <form action={goToCheckoutAction}>
              <button
                type="submit"
                className="mt-6 w-full h-11 rounded-md bg-accent text-bg text-sm font-semibold hover:brightness-110 transition"
              >
                Checkout
              </button>
            </form>
            <p className="mt-3 text-xs text-ink-mute leading-relaxed">
              Cash on delivery. You&rsquo;ll be asked for your phone number and
              delivery region on the next step.
            </p>
          </aside>
        </div>
      )}
    </section>
  );
}
