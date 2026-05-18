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
import { cleanProductTitle, formatPrice } from "@/lib/format";
import { CreateSellerForm } from "./CreateSellerForm";
import { LogoutButton } from "./LogoutButton";

// Maps the domain order-status enum (packages/domain/src/order/state-machine.ts)
// to French labels for the seller dashboard badge. The raw enum is English
// ("paid" / "shipped" / "delivered" / "cancelled" / "refunded" / "disputed"
// / "fulfilling" / "authorized" / "created") because it's a code identifier,
// but the dashboard is French and a seller seeing "PAID" mid-page is jarring.
const ORDER_STATUS_FR: Record<string, string> = {
  created: "créée",
  authorized: "autorisée",
  paid: "payée",
  fulfilling: "préparation",
  shipped: "expédiée",
  delivered: "livrée",
  cancelled: "annulée",
  refunded: "remboursée",
  disputed: "litige",
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // French chrome to match the buyer money path (cart/checkout/order),
  // the buyer-facing /seller/products/new and og:locale=fr_DZ.
  title: "Tableau de bord vendeur",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/seller");

  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(session.jwt, agentId);
  const sellers = sellersResp.data;

  return (
    <section className="pt-6 sm:pt-10 pb-24 max-w-5xl mx-auto" lang="fr">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight break-words">Tableau de bord vendeur</h1>
        <LogoutButton />
      </div>

      {sellers.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-line-soft bg-bg-soft/60 p-8">
          <h2 className="text-xl font-medium">Créez votre boutique</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Vous n’avez pas encore de boutique. Indiquez un nom pour commencer — vous pourrez ajouter les coordonnées et les produits ensuite.
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
  let products: {
    productId: string;
    title: string;
    brand?: string;
    variantCount?: number;
    inStock: boolean;
    priceMinor?: string;
    priceFromMinor?: string;
    priceToMinor?: string;
    currency?: string;
    heroImageUrl: string | null;
  }[] = [];
  let productsError: string | null = null;
  try {
    const r = await listProductsBySeller(seller.sellerId, sessionJwt);
    products = r.data.map((h) => ({
      productId: h.productId,
      title: h.title.value,
      brand: h.brand,
      variantCount: h.variantCount,
      inStock: h.inStock,
      priceMinor: h.priceMinor,
      priceFromMinor: h.priceFromMinor,
      priceToMinor: h.priceToMinor,
      currency: h.currency,
      heroImageUrl: h.heroImageUrl,
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

  // Glance metrics row: total orders, total revenue across orders, product
  // count. Revenue is summed across whichever currency is most common in the
  // order list — virtually always DZD for this marketplace; mixed-currency
  // sellers just see the dominant currency total.
  const revenueByCcy = orders.reduce<Record<string, bigint>>((acc, o) => {
    try {
      acc[o.currency] = (acc[o.currency] ?? 0n) + BigInt(o.subtotalMinor);
    } catch {
      // Skip lines we can't parse rather than failing the whole render.
    }
    return acc;
  }, {});
  const topCcy = Object.entries(revenueByCcy).sort((a, b) => Number(b[1] - a[1]))[0];

  return (
    <div className="rounded-2xl border border-line-soft bg-bg-soft/60">
      <header className="p-4 sm:p-6 border-b border-line-soft flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-medium break-words">{seller.displayName}</h2>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
            <span>
              <span className="text-ink font-medium">{products.length}</span> produit{products.length === 1 ? "" : "s"}
            </span>
            <span>
              <span className="text-ink font-medium">{orders.length}</span> commande{orders.length === 1 ? "" : "s"}
            </span>
            {topCcy && (
              <span>
                Total :{" "}
                <span className="text-ink font-medium">
                  {formatPrice(topCcy[1].toString(), topCcy[0])}
                </span>
              </span>
            )}
          </div>
          <ContactSummary seller={seller} />
        </div>
        <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
          <Link
            href={`/store/${encodeURIComponent(seller.sellerId)}`}
            className="text-sm px-3.5 h-9 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
          >
            Voir la boutique
          </Link>
          <Link
            href={`/seller/contact?sellerId=${encodeURIComponent(seller.sellerId)}`}
            className="text-sm px-3.5 h-9 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
          >
            Modifier les coordonnées
          </Link>
          <Link
            href={`/seller/products/new?sellerId=${encodeURIComponent(seller.sellerId)}`}
            className="text-sm px-3.5 h-9 inline-flex items-center rounded-md bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition"
          >
            Nouveau produit
          </Link>
        </div>
      </header>
      <div className="p-4 sm:p-6 border-b border-line-soft">
        <h3 className="text-sm font-medium text-ink-soft mb-3">
          Commandes ({orders.length})
        </h3>
        {ordersError ? (
          <p className="text-sm text-bad">Impossible de charger les commandes.</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-ink-mute">
            Aucune commande pour le moment. Dès qu’un acheteur commande, vous verrez son nom et son téléphone ici.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {orders.map((o) => (
              <li key={o.orderId} className="py-3 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-sm text-ink">#{o.publicNumber}</span>
                    <span className="text-xs text-ink-mute">
                      {new Date(o.createdAt).toLocaleString("fr-DZ")}
                    </span>
                    <span
                      title={o.status}
                      className={
                        "text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border " +
                        (o.status === "paid"
                          ? "border-ok/40 text-ok bg-ok/10"
                          : "border-line text-ink-mute")
                      }
                    >
                      {ORDER_STATUS_FR[o.status] ?? o.status}
                    </span>
                  </div>
                  {o.customer && (
                    <div className="mt-1 text-sm text-ink-soft">
                      <div className="text-ink">{o.customer.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <a
                          href={`tel:${o.customer.phone}`}
                          className="inline-flex items-center gap-1 px-3 h-9 sm:h-7 rounded-full bg-bg-elev border border-line-soft font-mono text-xs hover:text-accent hover:border-accent/40 active:text-accent active:border-accent/40 transition"
                          aria-label={`Appeler ${o.customer.name} au ${o.customer.phone}`}
                        >
                          {o.customer.phone}
                        </a>
                        {/* WhatsApp click-to-chat — most Algerian buyers prefer
                            WhatsApp over a phone call. Strip non-digits; wa.me
                            requires international format without the leading +. */}
                        <a
                          href={`https://wa.me/${o.customer.phone.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 h-9 sm:h-7 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 hover:bg-emerald-500/20 active:bg-emerald-500/25 transition"
                        >
                          WhatsApp
                        </a>
                        <span className="text-xs text-ink-mute">{o.customer.region}</span>
                      </div>
                    </div>
                  )}
                  <ul className="mt-2 text-xs text-ink-mute space-y-1">
                    {o.lines.map((l) => (
                      <li key={l.variantId} className="flex items-center gap-2 min-w-0">
                        {l.heroImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={l.heroImageUrl}
                            alt=""
                            className="w-8 h-8 rounded object-cover border border-line-soft bg-bg shrink-0"
                            loading="lazy"
                          />
                        ) : (
                          <span
                            aria-hidden
                            className="w-8 h-8 rounded border border-line-soft bg-bg-elev shrink-0"
                          />
                        )}
                        <span className="truncate">
                          × {l.qty}{" "}
                          <span className="untrusted">{l.title ? cleanProductTitle(l.title) : (l.sku ?? l.variantId)}</span>
                        </span>
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
      <div className="p-4 sm:p-6">
        <h3 className="text-sm font-medium text-ink-soft mb-3">
          Produits ({seller.productCount})
        </h3>
        {productsError ? (
          <p className="text-sm text-bad">Impossible de charger les produits.</p>
        ) : products.length === 0 ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-ink-mute">
              Aucun produit pour le moment. Ajoutez votre premier produit pour le rendre visible aux acheteurs.
            </p>
            <Link
              href={`/seller/products/new?sellerId=${encodeURIComponent(seller.sellerId)}`}
              className="text-sm px-3.5 h-10 sm:h-9 inline-flex items-center justify-center rounded-md bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition sm:shrink-0"
            >
              Ajouter
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {products.map((p) => (
              <li key={p.productId} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {p.heroImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.heroImageUrl}
                      alt=""
                      className="w-10 h-10 rounded object-cover border border-line-soft bg-bg shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="w-10 h-10 rounded border border-line-soft bg-bg-elev shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="text-ink truncate">{cleanProductTitle(p.title)}</div>
                    {p.brand && (
                      <div className="text-xs text-ink-mute">{p.brand}</div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft pl-[52px] sm:pl-0">
                  {p.currency && (p.priceMinor || p.priceFromMinor) && (
                    <span className="text-ink">
                      {p.priceMinor
                        ? formatPrice(p.priceMinor, p.currency)
                        : p.priceToMinor && p.priceToMinor !== p.priceFromMinor
                        ? `${formatPrice(p.priceFromMinor!, p.currency)} – ${formatPrice(p.priceToMinor, p.currency)}`
                        : formatPrice(p.priceFromMinor!, p.currency)}
                    </span>
                  )}
                  <span
                    className={
                      "px-2 py-0.5 rounded-full border " +
                      (p.inStock
                        ? "border-ok/40 text-ok bg-ok/10"
                        : "border-line text-ink-mute")
                    }
                  >
                    {p.inStock ? "en stock" : "rupture de stock"}
                  </span>
                  <Link
                    href={`/seller/products/${encodeURIComponent(p.productId)}/edit`}
                    className="px-3 h-9 sm:h-7 inline-flex items-center rounded-md border border-line hover:border-accent/40 hover:text-ink active:border-accent/40 active:text-ink transition"
                  >
                    Détails
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
    ["Téléphone", seller.phone],
    ["WhatsApp", seller.whatsapp],
    ["Site web", seller.website],
  ];
  const set = items.filter(([, v]) => v);
  if (set.length === 0) {
    return <p className="mt-2 text-xs text-ink-mute">Aucune coordonnée renseignée.</p>;
  }
  return (
    <ul className="mt-2 text-xs text-ink-soft space-y-0.5">
      {set.map(([k, v]) => (
        <li key={k}>
          <span className="text-ink-mute">{k} :</span> {v}
        </li>
      ))}
    </ul>
  );
}
