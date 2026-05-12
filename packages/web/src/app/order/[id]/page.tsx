import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder } from "@/lib/cart";
import { formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order confirmation",
  robots: { index: false, follow: false },
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id).catch(() => null);
  if (!order) notFound();

  return (
    <section className="pt-10 pb-24 max-w-3xl mx-auto">
      <div className="rounded-2xl border border-ok/40 bg-ok/5 p-6">
        <div className="text-xs uppercase tracking-widest text-ok font-semibold">Order placed</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          #{order.publicNumber}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          The seller will call to confirm before shipping. Keep this page open or
          take a screenshot — your order number is{" "}
          <span className="font-mono">{order.publicNumber}</span>.
        </p>
      </div>

      {order.customer && (
        <section className="mt-8 rounded-2xl border border-line-soft bg-bg-soft/60 p-6">
          <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold">Delivery contact</h2>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-ink-mute">Name</dt>
              <dd className="mt-0.5">{order.customer.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-mute">Phone</dt>
              <dd className="mt-0.5 font-mono">{order.customer.phone}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-mute">Region</dt>
              <dd className="mt-0.5">{order.customer.region}</dd>
            </div>
          </dl>
        </section>
      )}

      <section className="mt-8 rounded-2xl border border-line-soft bg-bg-soft/60 p-6">
        <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold">Items</h2>
        <ul className="mt-3 divide-y divide-line-soft">
          {order.lines.map((l) => (
            <li key={l.variantId} className="py-3 flex justify-between gap-4">
              <div className="min-w-0">
                {l.productId ? (
                  <Link href={`/product/${encodeURIComponent(l.productId)}`} className="text-sm text-ink hover:text-accent untrusted">
                    {l.title ?? l.sku ?? l.variantId}
                  </Link>
                ) : (
                  <span className="text-sm text-ink-soft">{l.sku ?? l.variantId}</span>
                )}
                <div className="text-xs text-ink-mute mt-0.5">
                  × {l.qty} · {formatPrice(l.unitPriceMinor, order.currency)} each
                </div>
              </div>
              <div className="shrink-0 text-sm font-medium">
                {formatPrice((BigInt(l.unitPriceMinor) * BigInt(l.qty)).toString(), order.currency)}
              </div>
            </li>
          ))}
        </ul>
        <dl className="mt-4 pt-4 border-t border-line-soft space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Subtotal</dt>
            <dd>{formatPrice(order.totals.subtotalMinor, order.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Delivery</dt>
            <dd className="text-ink-mute">
              {BigInt(order.totals.shippingMinor) > 0n
                ? formatPrice(order.totals.shippingMinor, order.currency)
                : "Free (cash on delivery)"}
            </dd>
          </div>
          {BigInt(order.totals.taxMinor) > 0n && (
            <div className="flex justify-between">
              <dt className="text-ink-soft">Tax</dt>
              <dd>{formatPrice(order.totals.taxMinor, order.currency)}</dd>
            </div>
          )}
        </dl>
        <div className="mt-3 pt-3 border-t border-line-soft flex justify-between text-base font-medium">
          <span>Total</span>
          <span>{formatPrice(order.totals.totalMinor, order.currency)}</span>
        </div>
      </section>

      <div className="mt-8 flex gap-3">
        <Link
          href="/search"
          className="inline-flex items-center px-4 py-2 rounded-md bg-accent text-bg text-sm font-medium hover:brightness-110 transition"
        >
          Continue shopping
        </Link>
      </div>
    </section>
  );
}
