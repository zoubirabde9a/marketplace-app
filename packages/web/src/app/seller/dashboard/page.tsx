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
import { cleanProductTitle, formatPrice, formatRelativeTime } from "@/lib/format";
import { CreateSellerForm } from "./CreateSellerForm";
import { LogoutButton } from "./LogoutButton";
import { OrderActions } from "./OrderActions";
import { OrdersListFilter } from "./OrdersListFilter";
import { ProductsListFilter } from "./ProductsListFilter";
import { OrderProgress } from "./OrderProgress";
import { StockToggle } from "./StockToggle";

// Status set that the seller still owes the buyer some action on. Mirrors
// the actionableCount calculation below so the filter chip's count and the
// per-row `data-actionable` attribute can't drift apart.
const ACTIONABLE_STATUSES: ReadonlySet<string> = new Set(["paid", "fulfilling", "disputed"]);

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
    <section aria-labelledby="dashboard-heading" className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-5xl mx-auto" lang="fr">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 id="dashboard-heading" className="text-2xl sm:text-3xl font-semibold tracking-tight break-words">Tableau de bord vendeur</h1>
          {/* Signed-in identity — quick "yes, this is my account" check
              for sellers on shared computers or multiple Google accounts.
              Subtle (text-xs, ink-mute) so it doesn't compete with the
              heading. */}
          {/* break-words wraps at word boundaries (good for the display
              name); the inner email span keeps break-all for emails that
              are one unbroken long string. Shop count surfaces upfront
              for multi-shop sellers who scroll a long dashboard. */}
          <p className="mt-2 text-xs text-ink-mute break-words">
            {sellers.length > 1 && (
              <>
                <span className="text-ink-soft tabular-nums">{sellers.length}</span> boutiques ·{" "}
              </>
            )}
            Connecté en tant que{" "}
            {session.user.displayName ? (
              <>
                <span dir="auto" className="text-ink-soft">{session.user.displayName}</span>{" "}
                <span dir="ltr" className="text-ink-mute break-all">({session.user.email})</span>
              </>
            ) : (
              <span dir="ltr" className="text-ink-soft break-all">{session.user.email}</span>
            )}
          </p>
        </div>
        <LogoutButton />
      </header>

      {sellers.length === 0 ? (
        <section aria-labelledby="create-seller-heading" className="mt-10 rounded-2xl border border-line-soft bg-bg-soft/60 p-8">
          <h2 id="create-seller-heading" className="text-xl font-medium">Créez votre boutique</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Vous n’avez pas encore de boutique. Indiquez un nom pour commencer — vous pourrez ajouter les coordonnées et les produits ensuite.
          </p>
          <div className="mt-6">
            <CreateSellerForm />
          </div>
        </section>
      ) : (
        <div className="mt-10 space-y-10">
          {sellers.map((s, i) => (
            <SellerSection
              key={s.sellerId}
              seller={s}
              sessionJwt={session.jwt}
              // Multi-shop sellers see every shop in a collapsible
              // disclosure: the first stays open, the rest fold to a
              // single summary row so the page is scannable at a
              // glance. Single-shop sellers (the common case) skip the
              // disclosure entirely and render as before.
              collapsible={sellers.length > 1}
              defaultOpen={i === 0}
            />
          ))}
        </div>
      )}

      {/* Support escape-hatch — sellers stuck on something (image won't
          upload, can't find a feature, want to delete a product) have
          had no point of contact from inside the dashboard. One link,
          pre-filled subject, no chrome. `<footer>` so it lands as a
          proper landmark in the page outline. */}
      <footer className="mt-10 pt-6 border-t border-line-soft text-xs text-ink-mute text-center">
        Besoin d’aide ?{" "}
        <a
          href={`mailto:mahlledz@gmail.com?subject=${encodeURIComponent("Aide vendeur")}&body=${encodeURIComponent(
            "Bonjour,\n\nJ'ai besoin d'aide concernant :\n\n",
          )}`}
          className="text-accent hover:underline active:underline"
        >
          contactez-nous
        </a>
        .
      </footer>
    </section>
  );
}

async function SellerSection({
  seller,
  sessionJwt,
  collapsible = false,
  defaultOpen = true,
}: {
  seller: SellerRecord;
  sessionJwt: string;
  /** Wrap the article in a <details> disclosure. Set true when the
   * seller owns more than one shop so the dashboard stays scannable. */
  collapsible?: boolean;
  /** When `collapsible` is true, render the disclosure expanded
   * initially. The first shop in the list gets this; subsequent shops
   * default closed. */
  defaultOpen?: boolean;
}) {
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
  let orders: SellerOrder[] = [];
  let ordersError: string | null = null;
  // Run the two independent fetches in parallel — they had been sequential,
  // doubling the latency of every shop render. allSettled keeps independent
  // error handling so a failure on one side doesn't lose the other side's
  // data.
  const [productsRes, ordersRes] = await Promise.allSettled([
    listProductsBySeller(seller.sellerId, sessionJwt),
    listSellerOrders(seller.sellerId, sessionJwt),
  ]);
  if (productsRes.status === "fulfilled") {
    products = productsRes.value.data.map((h) => ({
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
  } else {
    productsError = (productsRes.reason as Error).message;
  }
  if (ordersRes.status === "fulfilled") {
    orders = ordersRes.value.data;
  } else {
    ordersError = (ordersRes.reason as Error).message;
  }

  // Glance metrics row: total orders, total revenue across orders, product
  // count. Revenue is summed across whichever currency is most common in the
  // order list — virtually always DZD for this marketplace; mixed-currency
  // sellers just see the dominant currency total.
  // "À traiter" = orders the seller still owes the buyer some action on.
  // - paid: payment captured, seller must prepare/ship
  // - fulfilling: seller marked as in-prep, still owes shipment
  // - disputed: seller must respond
  // Excludes shipped/delivered/cancelled/refunded (closed) and
  // created/authorized (pre-payment, no seller action yet).
  const actionableCount = orders.filter((o) => ACTIONABLE_STATUSES.has(o.status)).length;

  const revenueByCcy = orders.reduce<Record<string, bigint>>((acc, o) => {
    try {
      acc[o.currency] = (acc[o.currency] ?? 0n) + BigInt(o.subtotalMinor);
    } catch {
      // Skip lines we can't parse rather than failing the whole render.
    }
    return acc;
  }, {});
  const topCcy = Object.entries(revenueByCcy).sort((a, b) => Number(b[1] - a[1]))[0];

  // Each shop is a self-contained unit — `<article>` is the right
  // semantic element. aria-labelledby points at the H2 so screen readers
  // announce "Article: <shop name>" when entering the card.
  const headingId = `shop-heading-${seller.sellerId}`;
  const article = (
    <article aria-labelledby={headingId} className="rounded-2xl border border-line-soft bg-bg-soft/60">
      <header className="p-4 sm:p-6 border-b border-line-soft flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0 sm:flex-1">
          <h2 id={headingId} dir="auto" className="text-xl font-medium tracking-tight break-words">{seller.displayName}</h2>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
            <span>
              <span className="text-ink font-medium">{products.length}</span> produit{products.length === 1 ? "" : "s"}
            </span>
            <span>
              <span className="text-ink font-medium">{orders.length}</span> commande{orders.length === 1 ? "" : "s"}
            </span>
            {actionableCount > 0 && (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent"
                aria-label={`${actionableCount} commande${actionableCount === 1 ? "" : "s"} à traiter`}
              >
                <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="font-medium tabular-nums">{actionableCount}</span> à traiter
              </span>
            )}
            {topCcy && (
              <span>
                Total :{" "}
                <span className="text-ink font-medium tabular-nums">
                  {formatPrice(topCcy[1].toString(), topCcy[0], "fr-DZ")}
                </span>
              </span>
            )}
          </div>
          <ContactSummary seller={seller} />
        </div>
        {/* Primary action ("Nouveau produit") leads — most prominent in
            both reading and tab order. Secondary actions follow. */}
        <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
          <Link
            href={`/seller/products/new?sellerId=${encodeURIComponent(seller.sellerId)}`}
            className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center rounded-md bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition"
          >
            Nouveau produit
          </Link>
          {/* Opens in a new tab so the seller can flip back to the
              dashboard without losing context — they typically check the
              storefront, then return to make changes. */}
          <Link
            href={`/store/${encodeURIComponent(seller.sellerId)}`}
            target="_blank"
            rel="noopener"
            className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
          >
            Voir la boutique <span aria-hidden>↗</span>
          </Link>
          <Link
            href={`/seller/contact?sellerId=${encodeURIComponent(seller.sellerId)}`}
            className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
          >
            Modifier les coordonnées
          </Link>
        </div>
      </header>
      <section aria-labelledby={`${headingId}-orders`} className="p-4 sm:p-6 border-b border-line-soft">
        <h3 id={`${headingId}-orders`} className="text-sm font-medium text-ink-soft mb-3">
          {orders.length === 1 ? "Commande" : "Commandes"} ({orders.length})
        </h3>
        {ordersError ? (
          <p className="text-sm text-bad">Impossible de charger les commandes.</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-ink-mute">
            {products.length === 0
              ? "Aucune commande possible tant que la boutique est vide — ajoutez un premier produit ci-dessous pour ouvrir aux acheteurs."
              : "Aucune commande pour le moment. Dès qu’un acheteur commande, vous verrez son nom et son téléphone ici."}
          </p>
        ) : (
          <OrdersListFilter actionableCount={actionableCount} totalCount={orders.length}>
          <ul className="divide-y divide-line-soft">
            {orders.map((o) => (
              <li
                key={o.orderId}
                data-actionable={ACTIONABLE_STATUSES.has(o.status) ? "true" : "false"}
                className="py-3 flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span dir="ltr" className="font-mono text-sm text-ink">#{o.publicNumber}</span>
                    <span
                      className="text-xs text-ink-mute tabular-nums"
                      title={new Date(o.createdAt).toLocaleString("fr-DZ")}
                    >
                      {formatRelativeTime(o.createdAt) ?? new Date(o.createdAt).toLocaleString("fr-DZ")}
                    </span>
                    <OrderProgress status={o.status} />
                  </div>
                  {o.customer && (
                    <div className="mt-1 text-sm text-ink-soft">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {/* `untrusted` adds the user-content indicator dot,
                            matching the line-item titles and the rest of the
                            app's convention for buyer/seller-supplied text. */}
                        <span dir="auto" className="text-ink untrusted">{o.customer.name}</span>
                        {/* Wilaya badge — sellers decide whether they can
                            deliver based on the customer's region, so it
                            needs to sit next to the customer's name rather
                            than buried with the contact buttons. */}
                        {o.customer.region && (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-ink-soft"
                            aria-label={`Wilaya : ${o.customer.region}`}
                          >
                            <span aria-hidden>📍</span>
                            <span dir="auto">{o.customer.region}</span>
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <a
                          href={`tel:${o.customer.phone}`}
                          dir="ltr"
                          className="inline-flex items-center gap-1 px-3 h-11 sm:h-7 rounded-full bg-bg-elev border border-line-soft font-mono text-xs hover:text-accent hover:border-accent/40 active:text-accent active:border-accent/40 transition"
                          aria-label={`Appeler ${o.customer.name} au ${o.customer.phone}`}
                        >
                          {o.customer.phone}
                        </a>
                        {/* WhatsApp click-to-chat — most Algerian buyers prefer
                            WhatsApp over a phone call. Strip non-digits; wa.me
                            requires international format without the leading +.
                            Pre-fill the message with the order number so the
                            seller doesn't have to type a greeting on every
                            call — the buyer immediately knows which order. */}
                        <a
                          href={`https://wa.me/${o.customer.phone.replace(/\D/g, "")}?text=${encodeURIComponent(
                            `Bonjour ${o.customer.name}, je vous contacte au sujet de votre commande #${o.publicNumber} sur Teno Store.`,
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Discuter avec ${o.customer.name} sur WhatsApp au sujet de la commande ${o.publicNumber}`}
                          className="inline-flex items-center gap-1 px-3 h-11 sm:h-7 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 hover:bg-emerald-500/20 active:bg-emerald-500/25 transition"
                        >
                          WhatsApp
                        </a>
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
                        {/* Qty badge in front of the title — won't truncate
                            even when the title overflows on mobile, so the
                            seller can always tell how many to pack. */}
                        <span
                          aria-label={`Quantité ${l.qty}`}
                          className="shrink-0 inline-flex items-center justify-center min-w-[1.75rem] px-1.5 h-5 rounded-full border border-line text-ink-soft bg-bg/60 font-medium tabular-nums"
                        >
                          ×{l.qty}
                        </span>
                        {/* Stack title above the variant SKU so multi-
                            variant products (same title, different colors
                            or storage) are unambiguous — sellers need to
                            know exactly which variant to pack. */}
                        <span className="min-w-0 flex-1 flex flex-col">
                          <span dir="auto" className="truncate untrusted">
                            {l.title ? cleanProductTitle(l.title) : (l.sku ?? l.variantId)}
                          </span>
                          {l.title && l.sku && (
                            <span className="font-mono text-[10px] text-ink-mute truncate">{l.sku}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {/* State-machine action buttons. The component handles
                      its own pending/error state and only renders buttons
                      that apply to the current status — closed orders
                      (delivered/cancelled/refunded) get nothing. */}
                  <OrderActions
                    sellerId={seller.sellerId}
                    orderId={o.orderId}
                    status={o.status as Parameters<typeof OrderActions>[0]["status"]}
                  />
                </div>
                <dl className="text-right shrink-0">
                  <dt className="text-[10px] uppercase tracking-widest text-ink-mute">Total</dt>
                  <dd className="text-sm font-medium tabular-nums">
                    {formatPrice(o.subtotalMinor, o.currency, "fr-DZ")}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
          </OrdersListFilter>
        )}
      </section>
      <section aria-labelledby={`${headingId}-products`} className="p-4 sm:p-6">
        <h3 id={`${headingId}-products`} className="text-sm font-medium text-ink-soft mb-3">
          {seller.productCount === 1 ? "Produit" : "Produits"} ({seller.productCount})
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
              className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center justify-center rounded-md bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition sm:shrink-0"
            >
              Ajouter <span aria-hidden>→</span>
            </Link>
          </div>
        ) : (
          <ProductsListFilter totalCount={products.length}>
          <ul className="divide-y divide-line-soft">
            {products.map((p) => (
              <li
                key={p.productId}
                data-search={`${cleanProductTitle(p.title)} ${p.brand ?? ""}`.toLowerCase()}
              >
                {/* Whole row is the edit affordance — bigger tap target on
                    mobile than the old "Détails" pill, and there's no second
                    action competing for the seller's attention. Negative
                    margin + padding extends the click surface to the row
                    edges without breaking the divider. */}
                <Link
                  href={`/seller/products/${encodeURIComponent(p.productId)}/edit`}
                  aria-label={`Modifier ${cleanProductTitle(p.title)}`}
                  className="-mx-2 px-2 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 rounded-lg hover:bg-bg/60 active:bg-bg/60 transition"
                >
                  <div className="flex items-center gap-3 min-w-0 sm:flex-1">
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
                    <div className="min-w-0 flex-1">
                      <div dir="auto" className="text-ink truncate">{cleanProductTitle(p.title)}</div>
                      {p.brand && (
                        <div className="text-xs text-ink-mute">{p.brand}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft pl-[52px] sm:pl-0">
                    {p.currency && (p.priceMinor || p.priceFromMinor) && (
                      <span className="text-ink">
                        {p.priceMinor
                          ? formatPrice(p.priceMinor, p.currency, "fr-DZ")
                          : p.priceToMinor && p.priceToMinor !== p.priceFromMinor
                          ? `${formatPrice(p.priceFromMinor!, p.currency, "fr-DZ")} – ${formatPrice(p.priceToMinor, p.currency, "fr-DZ")}`
                          : formatPrice(p.priceFromMinor!, p.currency, "fr-DZ")}
                      </span>
                    )}
                    {/* Variants badge — sellers managing multi-variant
                        listings (3 colors / 4 sizes / etc.) can spot them
                        at a glance instead of clicking in. */}
                    {p.variantCount !== undefined && p.variantCount > 1 && (
                      <span className="px-2 py-0.5 rounded-full border border-line text-ink-mute">
                        {p.variantCount} variantes
                      </span>
                    )}
                    {/* Single-variant products get a clickable inline
                        toggle so the seller can flip stock without a
                        round-trip to the edit page (most common edit
                        op). Multi-variant products keep the static
                        chip — per-variant stock should be picked
                        explicitly on the edit page. */}
                    {p.variantCount === undefined || p.variantCount <= 1 ? (
                      <StockToggle productId={p.productId} initialInStock={p.inStock} />
                    ) : (
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
                    )}
                    <span aria-hidden className="text-ink-mute">›</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          </ProductsListFilter>
        )}
      </section>
    </article>
  );

  if (!collapsible) return article;

  // Multi-shop disclosure. A thin clickable bar opens/closes the full
  // shop card. Even when expanded the bar stays — it's the affordance to
  // collapse back. `[&::-webkit-details-marker]:hidden` strips the
  // default browser triangle; we render our own chevron that flips on
  // open via `group-open:rotate-90`.
  return (
    <details open={defaultOpen} className="group rounded-2xl">
      <summary
        aria-controls={headingId}
        className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-bg-soft/40 active:bg-bg-soft/40 transition select-none"
      >
        <span
          aria-hidden
          className="text-ink-mute text-xs transition-transform duration-150 group-open:rotate-90 shrink-0"
        >
          ▶
        </span>
        <span dir="auto" className="text-sm font-medium text-ink truncate min-w-0 flex-1">
          {seller.displayName}
        </span>
        {actionableCount > 0 && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent text-xs shrink-0"
            aria-label={`${actionableCount} commande${actionableCount === 1 ? "" : "s"} à traiter`}
          >
            <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent" />
            <span className="font-medium tabular-nums">{actionableCount}</span> à traiter
          </span>
        )}
        <span className="text-xs text-ink-mute tabular-nums shrink-0 hidden sm:inline">
          {products.length} produit{products.length === 1 ? "" : "s"}
        </span>
      </summary>
      <div className="mt-2">{article}</div>
    </details>
  );
}

function ContactSummary({ seller }: { seller: SellerRecord }) {
  // kind drives the per-row rendering: "tel" → tel link with ltr, "wa" →
  // wa.me click-to-chat (test the WhatsApp path opens — WhatsApp lets you
  // message your own number, so "Send to self" is a real verification),
  // "url" → anchor link new tab. Website used to render as bare text.
  const items: Array<{ label: string; value: string | null | undefined; kind: "tel" | "wa" | "url" | "mailto" }> = [
    { label: "Téléphone", value: seller.phone, kind: "tel" },
    { label: "WhatsApp", value: seller.whatsapp, kind: "wa" },
    { label: "Site web", value: seller.website, kind: "url" },
    { label: "E-mail", value: seller.supportEmail, kind: "mailto" },
  ];
  const set = items.filter((i) => i.value);
  if (set.length === 0) {
    // CTA-prompt the seller to fill contact info when none is set —
    // empty contact => no way for buyers to reach them after orders.
    return (
      <p className="mt-2 text-xs text-ink-mute">
        Aucune coordonnée renseignée.{" "}
        <Link
          href={`/seller/contact?sellerId=${encodeURIComponent(seller.sellerId)}`}
          className="text-accent hover:underline active:underline"
        >
          Ajouter
        </Link>
      </p>
    );
  }
  return (
    <ul className="mt-2 text-xs text-ink-soft space-y-0.5">
      {set.map((i) => (
        <li key={i.label} className="break-all">
          <span className="text-ink-mute">{i.label} :</span>{" "}
          {i.kind === "tel" ? (
            <a href={`tel:${i.value}`} dir="ltr" className="text-ink hover:text-accent active:text-accent">
              {i.value}
            </a>
          ) : i.kind === "wa" ? (
            <a
              href={`https://wa.me/${i.value!.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="text-ink hover:text-accent active:text-accent"
            >
              {i.value}
            </a>
          ) : i.kind === "mailto" ? (
            <a href={`mailto:${i.value}`} dir="ltr" className="text-ink hover:text-accent active:text-accent">
              {i.value}
            </a>
          ) : (
            <a
              href={i.value!}
              target="_blank"
              rel="nofollow noopener"
              dir="ltr"
              className="text-ink hover:text-accent active:text-accent"
            >
              {i.value}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
