import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCart } from "@/lib/cart";
import { formatPrice } from "@/lib/format";
import { ALGERIAN_WILAYAS } from "./wilayas";
import { placeOrderAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout",
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
  const params = await searchParams;
  const errCode = params.err;
  const errLabel = !errCode
    ? null
    : errCode === "missing"
      ? "Please fill in your name, phone, and region."
      : "Sorry, something went wrong placing the order. Try again.";

  return (
    <section className="pt-10 pb-24 max-w-3xl mx-auto">
      <Link href="/cart" className="text-xs text-ink-mute hover:text-ink-soft">
        ← Back to cart
      </Link>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Checkout</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Cash on delivery. The seller will call to confirm before shipping.
      </p>

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
              Full name
            </label>
            <input
              id="name"
              name="name"
              required
              maxLength={120}
              autoComplete="name"
              className="w-full h-11 px-3 rounded-md border border-line bg-bg-elev text-sm"
            />
          </div>
          <div>
            <label htmlFor="phone" className="block text-xs uppercase tracking-widest text-ink-mute font-semibold mb-1">
              Phone (the seller will call this number)
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
              className="w-full h-11 px-3 rounded-md border border-line bg-bg-elev text-sm font-mono"
            />
          </div>
          <div>
            <label htmlFor="region" className="block text-xs uppercase tracking-widest text-ink-mute font-semibold mb-1">
              Delivery region (wilaya)
            </label>
            <select
              id="region"
              name="region"
              required
              defaultValue=""
              className="w-full h-11 px-3 rounded-md border border-line bg-bg-elev text-sm"
            >
              <option value="" disabled>
                Select a wilaya…
              </option>
              {ALGERIAN_WILAYAS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="mt-4 w-full h-11 rounded-md bg-accent text-bg text-sm font-semibold hover:brightness-110 transition"
          >
            Place order
          </button>
        </form>

        <aside className="rounded-2xl border border-line-soft bg-bg-soft/60 p-6 h-fit">
          <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold">Order summary</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {cart.lines.map((l) => (
              <li key={l.variantId} className="flex justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate untrusted">{l.title ?? l.sku ?? l.variantId}</div>
                  <div className="text-xs text-ink-mute">× {l.qty}</div>
                </div>
                <div className="shrink-0 text-right">
                  {formatPrice(
                    (BigInt(l.unitPriceMinor) * BigInt(l.qty)).toString(),
                    cart.currency,
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-4 border-t border-line-soft flex justify-between text-base font-medium">
            <span>Total</span>
            <span>{formatPrice(cart.totals.subtotalMinor, cart.currency)}</span>
          </div>
        </aside>
      </div>
    </section>
  );
}
