import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, syntheticAgentId } from "@/lib/sellerSession";
import {
  listMySellers,
  listProductsBySeller,
  listSellerOrders,
  type SellerOrder,
  type SellerRecord,
} from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { CreateSellerForm } from "./CreateSellerForm";
import { LogoutButton } from "./LogoutButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Seller dashboard",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/seller");

  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(session.jwt, agentId);
  const sellers = sellersResp.data;

  return (
    <section className="pt-10 pb-24 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Seller dashboard</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Signed in as <span className="text-ink">{session.user.email}</span>
            {session.user.displayName ? ` (${session.user.displayName})` : ""}.
          </p>
        </div>
        <LogoutButton />
      </div>

      {sellers.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-line-soft bg-bg-soft/60 p-8">
          <h2 className="text-xl font-medium">Create your seller profile</h2>
          <p className="mt-2 text-sm text-ink-soft">
            You don&apos;t have a seller profile yet. Set a display name to get
            started — you can add contact info and products afterwards.
          </p>
          <div className="mt-6">
            <CreateSellerForm />
          </div>
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          {sellers.map((s) => (
            <SellerSection key={s.sellerId} seller={s} sessionJwt={session.jwt} />
          ))}
        </div>
      )}
    </section>
  );
}

async function SellerSection({ seller, sessionJwt }: { seller: SellerRecord; sessionJwt: string }) {
  let products: { productId: string; title: string; brand?: string; variantCount?: number; inStock: boolean }[] = [];
  let productsError: string | null = null;
  try {
    const r = await listProductsBySeller(seller.sellerId, sessionJwt);
    products = r.data.map((h) => ({
      productId: h.productId,
      title: h.title.value,
      brand: h.brand,
      variantCount: h.variantCount,
      inStock: h.inStock,
    }));
  } catch (e) {
    productsError = (e as Error).message;
  }

  let orders: SellerOrder[] = [];
  let ordersError: string | null = null;
  try {
    const r = await listSellerOrders(seller.sellerId, sessionJwt);
    orders = r.data;
  } catch (e) {
    ordersError = (e as Error).message;
  }

  return (
    <div className="rounded-2xl border border-line-soft bg-bg-soft/60">
      <header className="p-6 border-b border-line-soft flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium">{seller.displayName}</h2>
          <p className="mt-1 text-xs text-ink-mute font-mono">{seller.sellerId}</p>
          <ContactSummary seller={seller} />
        </div>
        <div className="flex flex-col gap-2 items-end">
          <Link
            href={`/seller/contact?sellerId=${encodeURIComponent(seller.sellerId)}`}
            className="text-sm px-3 py-1.5 rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 transition"
          >
            Edit contact info
          </Link>
          <Link
            href={`/seller/products/new?sellerId=${encodeURIComponent(seller.sellerId)}`}
            className="text-sm px-3 py-1.5 rounded-md bg-accent text-bg font-medium hover:bg-accent-hover transition"
          >
            New product
          </Link>
        </div>
      </header>
      <div className="p-6 border-b border-line-soft">
        <h3 className="text-sm font-medium text-ink-soft mb-3">
          Orders ({orders.length})
        </h3>
        {ordersError ? (
          <p className="text-sm text-bad">Failed to load orders: {ordersError}</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-ink-mute">No orders yet.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {orders.map((o) => (
              <li key={o.orderId} className="py-3 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-ink">#{o.publicNumber}</span>
                    <span className="text-xs text-ink-mute">
                      {new Date(o.createdAt).toLocaleString("fr-DZ")}
                    </span>
                    <span
                      className={
                        "text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border " +
                        (o.status === "paid"
                          ? "border-ok/40 text-ok bg-ok/10"
                          : "border-line text-ink-mute")
                      }
                    >
                      {o.status}
                    </span>
                  </div>
                  {o.customer && (
                    <div className="mt-1 text-sm text-ink-soft">
                      <span className="text-ink">{o.customer.name}</span>
                      <span className="text-ink-mute"> · </span>
                      <a href={`tel:${o.customer.phone}`} className="font-mono hover:text-accent">
                        {o.customer.phone}
                      </a>
                      <span className="text-ink-mute"> · {o.customer.region}</span>
                    </div>
                  )}
                  <ul className="mt-2 text-xs text-ink-mute space-y-0.5">
                    {o.lines.map((l) => (
                      <li key={l.variantId} className="truncate">
                        × {l.qty}{" "}
                        <span className="untrusted">{l.title ?? l.sku ?? l.variantId}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-medium">
                    {formatPrice(o.subtotalMinor, o.currency)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="p-6">
        <h3 className="text-sm font-medium text-ink-soft mb-3">
          Products ({seller.productCount})
        </h3>
        {productsError ? (
          <p className="text-sm text-bad">Failed to load products: {productsError}</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-ink-mute">No products yet.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {products.map((p) => (
              <li key={p.productId} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-ink truncate">{p.title}</div>
                  <div className="text-xs text-ink-mute font-mono">{p.productId}</div>
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-soft">
                  {p.brand && <span className="text-ink-mute">{p.brand}</span>}
                  <span
                    className={
                      "px-2 py-0.5 rounded-full border " +
                      (p.inStock
                        ? "border-ok/40 text-ok bg-ok/10"
                        : "border-line text-ink-mute")
                    }
                  >
                    {p.inStock ? "in stock" : "out of stock"}
                  </span>
                  <Link
                    href={`/seller/products/${encodeURIComponent(p.productId)}/edit`}
                    className="px-2 py-1 rounded-md border border-line hover:border-accent/40 hover:text-ink transition"
                  >
                    Edit
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ContactSummary({ seller }: { seller: SellerRecord }) {
  const items: Array<[string, string | null]> = [
    ["phone", seller.phone],
    ["whatsapp", seller.whatsapp],
    ["website", seller.website],
  ];
  const set = items.filter(([, v]) => v);
  if (set.length === 0) {
    return <p className="mt-2 text-xs text-ink-mute">No contact info set.</p>;
  }
  return (
    <ul className="mt-2 text-xs text-ink-soft space-y-0.5">
      {set.map(([k, v]) => (
        <li key={k}>
          <span className="text-ink-mute">{k}:</span> {v}
        </li>
      ))}
    </ul>
  );
}
