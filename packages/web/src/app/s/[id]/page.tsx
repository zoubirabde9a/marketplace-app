// Snapshot viewer — spec §8.4.
//
// Renders a frozen copy of an MCP catalog tool result so a human can see
// exactly what the agent saw at request time. Snapshots are public-token
// addressed, read-only, and expire 24h after capture.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getProduct, getSeller } from "@/lib/api";

const API_URL = (process.env.MARKETPLACE_API_URL ?? "http://localhost:3100").replace(/\/$/, "");

// UUIDs (v4/v7) look like 8-4-4-4-12 hex with hyphens. The API's snapshot-id
// validator (`^[A-Za-z0-9_-]{16,64}$`) happily accepts them, so when someone
// pastes a sellerId or productId into /s/<id> we have to disambiguate
// ourselves. Snapshot tokens are 22-char base64url (no hyphens, never
// 36 chars), so a fast shape check beats hitting the API for every miss.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = {
  title: "Agent result snapshot",
  robots: { index: false, follow: false },
};

type Snapshot = {
  id: string;
  kind: "search" | "product" | "compare" | "recommend" | "seller_create" | "product_create";
  input: unknown;
  output: unknown;
  createdAt: number;
  expiresAt: number;
};

async function fetchSnapshot(
  id: string,
): Promise<Snapshot | { expired: true } | { unauthorized: true } | null> {
  const res = await fetch(`${API_URL}/v1/snapshots/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (res.status === 410) return { expired: true };
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) return { unauthorized: true };
  if (!res.ok) return null;
  return (await res.json()) as Snapshot;
}

function plain(v: unknown): string {
  if (v && typeof v === "object" && (v as { role?: string }).role === "untrusted_content") {
    return String((v as { value: unknown }).value ?? "");
  }
  return typeof v === "string" ? v : JSON.stringify(v);
}

function formatRemaining(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** When a snapshot lookup misses, try to recognise the id as an entity (seller / product)
 *  that was accidentally pasted into the snapshot URL. Returns the redirect target if found. */
async function recogniseEntity(id: string): Promise<string | null> {
  if (!UUID_RE.test(id)) return null;
  const [seller, product] = await Promise.all([
    getSeller(id).catch(() => null),
    getProduct(id).catch(() => null),
  ]);
  if (seller) return `/store/${id}`;
  if (product) return `/product/${id}`;
  return null;
}

export default async function SnapshotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snap = await fetchSnapshot(id);

  // For any negative outcome, first check whether the id is actually a seller
  // or product UUID. Pasting an entity id into /s/<id> is the most common way
  // users land here without a real snapshot; sending them to the right page is
  // strictly better than telling them their snapshot expired.
  if (!snap || "expired" in snap) {
    const target = await recogniseEntity(id);
    if (target) redirect(target);
  }

  if (!snap) {
    // notFound() returns HTTP 404 — link checkers, crawlers, and upstream caches
    // need that signal. The route-scoped not-found.tsx renders the friendly text
    // ("snapshot tokens look like…") so we don't lose the recipient-facing UX.
    notFound();
  }

  if ("unauthorized" in snap) {
    return (
      <article className="max-w-3xl mx-auto p-6" lang="en">
        <h1 className="text-2xl font-semibold mb-2">Snapshot access denied</h1>
        <p className="text-ink-soft">
          This snapshot exists but isn’t accessible from this link. The token
          may have been revoked or wasn’t included in the URL.
        </p>
        <Link href="/" className="text-accent hover:underline">Back to marketplace</Link>
      </article>
    );
  }

  if ("expired" in snap) {
    // Next.js RSC doesn't expose HTTP 410 (Gone); 404 via notFound() is the
    // closest honest signal we have. The route-scoped not-found.tsx renders
    // the expired-friendly text ("snapshots kept for 24 hours…").
    notFound();
  }

  const created = new Date(snap.createdAt).toISOString();
  const remaining = formatRemaining(snap.expiresAt);
  const kindLabel: Record<Snapshot["kind"], string> = {
    search: "search",
    product: "product",
    compare: "compare",
    recommend: "recommend",
    seller_create: "seller create",
    product_create: "product create",
  };
  const heading =
    snap.kind === "seller_create" || snap.kind === "product_create"
      ? "What the agent created"
      : "What the agent saw";

  return (
    <article className="max-w-5xl mx-auto p-6" lang="en">
      <header className="mb-6 border-b border-line-soft pb-4">
        <p className="text-xs uppercase tracking-widest text-ink-mute font-semibold">
          Agent {kindLabel[snap.kind]} snapshot
        </p>
        <h1 className="text-2xl font-semibold mt-1">{heading}</h1>
        <p className="text-sm text-ink-soft mt-2">
          Captured {created} · expires in {remaining} · this is a frozen copy and will not update.
        </p>
      </header>

      {snap.kind === "search" && <SearchSnapshot output={snap.output} input={snap.input} />}
      {snap.kind === "product" && <ProductSnapshot output={snap.output} />}
      {snap.kind === "compare" && <RawSnapshot output={snap.output} />}
      {snap.kind === "recommend" && <RawSnapshot output={snap.output} />}
      {snap.kind === "seller_create" && <SellerCreateSnapshot output={snap.output} />}
      {snap.kind === "product_create" && <ProductCreateSnapshot output={snap.output} />}
    </article>
  );
}

function SearchSnapshot({ output, input }: { output: unknown; input: unknown }) {
  const o = output as {
    hits?: Array<{
      productId: string;
      title: unknown;
      brand?: string;
      priceMinor?: string;
      currency?: string;
      rating?: number;
      ratingCount?: number;
      inStock: boolean;
      sellerId: string | null;
      counterfeitRisk: "low" | "elevated" | "high";
      relevanceScore: number;
    }>;
    totalEstimate?: number;
  };
  // The snapshot's `input` may carry the literal `query` string (older
  // snapshots) OR a nested SearchQuery object: { query: { query: "...",
  // filters, sort, limit, embeddingsMode } } (current shape from
  // captureRestSnapshot in routes/products.ts). Live probe of /s/{id}
  // found React crashing with 'Objects are not valid as a React child'
  // when the nested object was rendered directly. Handle both shapes.
  const i = input as { query?: string | { query?: string } } | null;
  const queryText = typeof i?.query === "string"
    ? i.query
    : typeof i?.query?.query === "string"
      ? i.query.query
      : undefined;

  return (
    <section>
      {queryText && <p className="text-sm text-ink-soft mb-3">Query: <span className="font-mono">{queryText}</span></p>}
      <p className="text-sm text-ink-mute mb-4">
        {o.hits?.length ?? 0} of ~{o.totalEstimate ?? 0} results
      </p>
      <ul className="grid gap-3">
        {(o.hits ?? []).map((h) => (
          <li key={h.productId} className="border border-line-soft bg-bg-soft/60 rounded p-3">
            <div className="flex justify-between items-baseline">
              <h2 className="font-medium">{plain(h.title)}</h2>
              {h.priceMinor && (
                <span className="text-sm">
                  {(Number(h.priceMinor) / 100).toFixed(2)} {h.currency}
                </span>
              )}
            </div>
            <p className="text-xs text-ink-mute mt-1">
              {h.brand ? `${h.brand} · ` : ""}seller {h.sellerId}
              {!h.inStock ? " · out of stock" : ""}
              {h.counterfeitRisk !== "low" ? ` · risk: ${h.counterfeitRisk}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProductSnapshot({ output }: { output: unknown }) {
  const p = output as {
    productId: string;
    title?: unknown;
    description?: unknown;
    brand?: string;
    sellerId: string | null;
    variants?: Array<{ id: string; sku: string; priceMinor: string; currency: string; inStock: boolean }>;
  };
  return (
    <section>
      <h2 className="text-xl font-medium">{plain(p.title)}</h2>
      <p className="text-xs text-ink-mute mt-1">
        {p.brand ? `${p.brand} · ` : ""}seller {p.sellerId} · id {p.productId}
      </p>
      {p.description ? <p className="mt-3 whitespace-pre-wrap text-ink-soft">{plain(p.description)}</p> : null}
      {p.variants?.length ? (
        <table className="mt-4 text-sm w-full">
          <caption className="sr-only">Product variants — SKU, price, and stock status</caption>
          <thead className="text-left text-ink-mute text-xs uppercase tracking-wider">
            <tr>
              <th scope="col" className="py-2">SKU</th>
              <th scope="col">Price</th>
              <th scope="col">Stock</th>
            </tr>
          </thead>
          <tbody>
            {p.variants.map((v) => (
              <tr key={v.id} className="border-t border-line-soft">
                <td className="py-2 font-mono text-xs text-ink-soft">{v.sku}</td>
                <td>{(Number(v.priceMinor) / 100).toFixed(2)} {v.currency}</td>
                <td>
                  {v.inStock ? (
                    <span className="text-ok text-xs"><span aria-hidden>●</span> in stock</span>
                  ) : (
                    <span className="text-ink-mute text-xs"><span aria-hidden>○</span> out</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

function SellerCreateSnapshot({ output }: { output: unknown }) {
  const s = output as {
    sellerId: string | null;
    displayName?: string;
    ownerAgentId?: string;
    phone?: string | null;
    whatsapp?: string | null;
    phones?: Array<{ phone: string; isWhatsapp: boolean; isViber: boolean; isPrimary: boolean }>;
    website?: string | null;
    description?: string | null;
    supportEmail?: string | null;
    city?: string | null;
    countryCode?: string | null;
    createdAt?: string;
  };
  const location = [s.city, s.countryCode].filter(Boolean).join(", ");
  const hasPhones = s.phones && s.phones.length > 0;
  return (
    <section>
      <h2 className="text-xl font-medium">{s.displayName ?? "(unnamed seller)"}</h2>
      <p className="text-xs text-ink-mute mt-1">seller {s.sellerId}</p>
      {s.description ? (
        <p className="mt-3 text-ink-soft whitespace-pre-wrap">{s.description}</p>
      ) : null}
      <dl className="mt-4 text-sm grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {location ? (<><dt className="text-ink-mute">Location</dt><dd>{location}</dd></>) : null}
        {hasPhones ? (
          <>
            <dt className="text-ink-mute">Phones</dt>
            <dd>
              <ul>
                {s.phones!.map((p) => (
                  <li key={p.phone}>
                    <span className="font-mono">{p.phone}</span>
                    {p.isPrimary ? <span className="text-xs text-ink-mute"> · primary</span> : null}
                    {p.isWhatsapp ? <span className="text-xs text-ink-mute"> · WhatsApp</span> : null}
                    {p.isViber ? <span className="text-xs text-ink-mute"> · Viber</span> : null}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        ) : s.phone ? (
          <>
            <dt className="text-ink-mute">Phone</dt>
            <dd className="font-mono">{s.phone}</dd>
          </>
        ) : null}
        {!hasPhones && s.whatsapp ? (<><dt className="text-ink-mute">WhatsApp</dt><dd className="font-mono">{s.whatsapp}</dd></>) : null}
        {s.website ? (<><dt className="text-ink-mute">Website</dt><dd><a className="text-accent hover:underline" href={s.website}>{s.website}</a></dd></>) : null}
        {s.supportEmail ? (<><dt className="text-ink-mute">Support</dt><dd><a className="text-accent hover:underline" href={`mailto:${s.supportEmail}`}>{s.supportEmail}</a></dd></>) : null}
        {s.ownerAgentId ? (<><dt className="text-ink-mute">Owner agent</dt><dd className="font-mono text-xs">{s.ownerAgentId}</dd></>) : null}
        {s.createdAt ? (<><dt className="text-ink-mute">Created</dt><dd>{s.createdAt}</dd></>) : null}
      </dl>
      {s.sellerId && (
        <p className="mt-6">
          <Link className="text-accent hover:underline font-medium" href={`/store/${s.sellerId}`}>
            View live storefront →
          </Link>
        </p>
      )}
    </section>
  );
}

function ProductCreateSnapshot({ output }: { output: unknown }) {
  const p = output as {
    productId: string;
    sellerId: string | null;
    title?: string;
    description?: string;
    brand?: string;
    variants?: Array<{ id: string; sku: string; priceMinor: string; currency: string; inStock: boolean }>;
    media?: Array<{ id: string; url: string }>;
    heroMediaId?: string | null;
    createdAt?: string;
  };
  return (
    <section>
      <h2 className="text-xl font-medium">{p.title ?? "(untitled product)"}</h2>
      <p className="text-xs text-ink-mute mt-1">
        {p.brand ? `${p.brand} · ` : ""}seller {p.sellerId} · id {p.productId}
      </p>
      {p.description ? (
        <p className="mt-3 text-ink-soft whitespace-pre-wrap">{p.description}</p>
      ) : null}
      {p.media?.length ? (
        <ul className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {p.media.map((m) => (
            <li key={m.id} className="border border-line-soft rounded overflow-hidden bg-bg-soft/60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt="" loading="lazy" className="w-full aspect-square object-cover" />
            </li>
          ))}
        </ul>
      ) : null}
      {p.variants?.length ? (
        <table className="mt-4 text-sm w-full">
          <caption className="sr-only">Product variants — SKU, price, and stock status</caption>
          <thead className="text-left text-ink-mute text-xs uppercase tracking-wider">
            <tr>
              <th scope="col" className="py-2">SKU</th>
              <th scope="col">Price</th>
              <th scope="col">Stock</th>
            </tr>
          </thead>
          <tbody>
            {p.variants.map((v) => (
              <tr key={v.id} className="border-t border-line-soft">
                <td className="py-2 font-mono text-xs text-ink-soft">{v.sku}</td>
                <td>{(Number(v.priceMinor) / 100).toFixed(2)} {v.currency}</td>
                <td>
                  {v.inStock ? (
                    <span className="text-ok text-xs"><span aria-hidden>●</span> in stock</span>
                  ) : (
                    <span className="text-ink-mute text-xs"><span aria-hidden>○</span> out</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {p.createdAt ? <p className="text-xs text-ink-mute mt-3">Created {p.createdAt}</p> : null}
      <p className="mt-6 flex gap-4">
        <Link className="text-accent hover:underline font-medium" href={`/product/${p.productId}`}>
          View live product page →
        </Link>
        {p.sellerId && (
          <Link className="text-accent hover:underline" href={`/store/${p.sellerId}`}>
            Go to store
          </Link>
        )}
      </p>
    </section>
  );
}

function RawSnapshot({ output }: { output: unknown }) {
  return (
    <pre className="text-xs bg-bg-soft/60 border border-line-soft rounded p-3 overflow-auto text-ink-soft">
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}
