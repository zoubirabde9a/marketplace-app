// Snapshot viewer — spec §8.4.
//
// Renders a frozen copy of an MCP catalog tool result so a human can see
// exactly what the agent saw at request time. Snapshots are public-token
// addressed, read-only, and expire 24h after capture.

import type { Metadata } from "next";
import Link from "next/link";

const API_URL = (process.env.MARKETPLACE_API_URL ?? "http://localhost:3100").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "Agent result snapshot",
  robots: { index: false, follow: false },
};

type Snapshot = {
  id: string;
  kind: "search" | "product" | "compare" | "recommend";
  input: unknown;
  output: unknown;
  createdAt: number;
  expiresAt: number;
};

async function fetchSnapshot(id: string): Promise<Snapshot | { expired: true } | null> {
  const res = await fetch(`${API_URL}/v1/snapshots/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (res.status === 410) return { expired: true };
  if (res.status === 404) return null;
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

export default async function SnapshotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snap = await fetchSnapshot(id);

  if (!snap) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-2">Snapshot not found</h1>
        <p className="text-gray-600">This link is invalid.</p>
        <Link href="/" className="text-blue-600 underline">Back to marketplace</Link>
      </main>
    );
  }

  if ("expired" in snap) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-2">Snapshot expired</h1>
        <p className="text-gray-600 mb-4">
          Agent result snapshots are kept for 24 hours and then deleted. Ask the agent to run the
          request again to get a fresh snapshot.
        </p>
        <Link href="/" className="text-blue-600 underline">Back to marketplace</Link>
      </main>
    );
  }

  const created = new Date(snap.createdAt).toISOString();
  const remaining = formatRemaining(snap.expiresAt);

  return (
    <main className="max-w-5xl mx-auto p-6">
      <header className="mb-6 border-b pb-4">
        <p className="text-sm text-gray-500 uppercase tracking-wide">
          Agent {snap.kind} snapshot
        </p>
        <h1 className="text-2xl font-semibold mt-1">What the agent saw</h1>
        <p className="text-sm text-gray-600 mt-2">
          Captured {created} · expires in {remaining} · this is a frozen copy and will not update.
        </p>
      </header>

      {snap.kind === "search" && <SearchSnapshot output={snap.output} input={snap.input} />}
      {snap.kind === "product" && <ProductSnapshot output={snap.output} />}
      {snap.kind === "compare" && <RawSnapshot output={snap.output} />}
      {snap.kind === "recommend" && <RawSnapshot output={snap.output} />}
    </main>
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
      sellerId: string;
      counterfeitRisk: "low" | "elevated" | "high";
      relevanceScore: number;
    }>;
    totalEstimate?: number;
  };
  const i = input as { query?: string } | null;

  return (
    <section>
      {i?.query && <p className="text-sm text-gray-600 mb-3">Query: <span className="font-mono">{i.query}</span></p>}
      <p className="text-sm text-gray-500 mb-4">
        {o.hits?.length ?? 0} of ~{o.totalEstimate ?? 0} results
      </p>
      <ul className="grid gap-3">
        {(o.hits ?? []).map((h) => (
          <li key={h.productId} className="border rounded p-3">
            <div className="flex justify-between items-baseline">
              <h2 className="font-medium">{plain(h.title)}</h2>
              {h.priceMinor && (
                <span className="text-sm">
                  {(Number(h.priceMinor) / 100).toFixed(2)} {h.currency}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
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
    sellerId: string;
    variants?: Array<{ id: string; sku: string; priceMinor: string; currency: string; inStock: boolean }>;
  };
  return (
    <section>
      <h2 className="text-xl font-medium">{plain(p.title)}</h2>
      <p className="text-xs text-gray-500 mt-1">
        {p.brand ? `${p.brand} · ` : ""}seller {p.sellerId} · id {p.productId}
      </p>
      {p.description ? <p className="mt-3 whitespace-pre-wrap">{plain(p.description)}</p> : null}
      {p.variants?.length ? (
        <table className="mt-4 text-sm w-full">
          <thead className="text-left text-gray-500">
            <tr><th>SKU</th><th>Price</th><th>Stock</th></tr>
          </thead>
          <tbody>
            {p.variants.map((v) => (
              <tr key={v.id} className="border-t">
                <td className="py-1 font-mono">{v.sku}</td>
                <td>{(Number(v.priceMinor) / 100).toFixed(2)} {v.currency}</td>
                <td>{v.inStock ? "in stock" : "out"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

function RawSnapshot({ output }: { output: unknown }) {
  return (
    <pre className="text-xs bg-gray-50 border rounded p-3 overflow-auto">
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}
