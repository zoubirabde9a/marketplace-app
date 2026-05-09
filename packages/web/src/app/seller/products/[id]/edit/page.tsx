import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, syntheticAgentId } from "@/lib/sellerSession";
import { getProduct, listMySellers } from "@/lib/api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edit product",
  robots: { index: false, follow: false },
};

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/seller");
  const { id } = await params;

  const product = await getProduct(id);
  if (!product) {
    return (
      <section className="pt-10 pb-24 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold">Edit product</h1>
        <p className="mt-4 text-sm text-ink-soft">
          Product not found.{" "}
          <Link href="/seller/dashboard" className="text-accent hover:underline">
            Back to dashboard
          </Link>
          .
        </p>
      </section>
    );
  }

  // Ownership check: this product must belong to one of the signed-in user's
  // sellers. Otherwise we treat it as not editable.
  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(session.jwt, agentId);
  const owns = sellersResp.data.some((s) => s.sellerId === product.sellerId);
  if (!owns) {
    return (
      <section className="pt-10 pb-24 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold">Edit product</h1>
        <p className="mt-4 text-sm text-bad">
          You don&apos;t own this product.
        </p>
        <Link href="/seller/dashboard" className="mt-3 inline-block text-accent hover:underline">
          Back to dashboard
        </Link>
      </section>
    );
  }

  return (
    <section className="pt-10 pb-24 max-w-3xl mx-auto">
      <Link href="/seller/dashboard" className="text-sm text-ink-soft hover:text-ink">
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Edit product</h1>
      <p className="mt-2 text-xs text-ink-mute font-mono">{product.productId}</p>

      <div className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-6 space-y-4">
        <Field label="Title" value={product.title.value} />
        <Field label="Brand" value={product.brand ?? ""} />
        <Field
          label="Description"
          value={product.description?.value ?? ""}
          multiline
        />
        <Field label="Categories" value={product.categoryIds.join(", ")} />
      </div>

      <div className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-6">
        <h2 className="text-lg font-medium">Variants</h2>
        {product.variants.length === 0 ? (
          <p className="mt-3 text-sm text-ink-mute">No variants.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft">
            {product.variants.map((v) => (
              <li key={v.id} className="py-3 flex items-center justify-between text-sm">
                <span className="font-mono text-ink-soft">{v.sku}</span>
                <span className="text-ink">
                  {formatPrice(v.priceMinor, v.currency)}{" "}
                  <span className="text-xs text-ink-mute">{v.currency}</span>
                </span>
                <span
                  className={
                    "text-xs px-2 py-0.5 rounded-full border " +
                    (v.inStock
                      ? "border-ok/40 text-ok bg-ok/10"
                      : "border-line text-ink-mute")
                  }
                >
                  {v.inStock ? "in stock" : "out of stock"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-6">
        <h2 className="text-lg font-medium">Images</h2>
        {product.images.length === 0 ? (
          <p className="mt-3 text-sm text-ink-mute">No images.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-3 gap-3">
            {product.images.map((m) => (
              <li
                key={m.id}
                className="aspect-square rounded-lg overflow-hidden border border-line bg-bg"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.url}
                  alt={m.altText ?? "product image"}
                  className="w-full h-full object-cover"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-warn/30 bg-warn/5 p-4 text-sm text-ink-soft">
        <strong className="text-warn">Stubbed:</strong> editing existing
        products, adding/editing variants, and uploading or deleting images
        are not yet exposed by the API. The relevant endpoints (
        <code className="font-mono">PATCH /v1/products/:id</code>,{" "}
        <code className="font-mono">POST /v1/products/:id/media</code>,
        delete) don&apos;t exist on this build, so this page is read-only for
        now. Recreate the product to change its fields.
      </div>
    </section>
  );
}

function Field({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-mute mb-1">{label}</div>
      {multiline ? (
        <pre className="whitespace-pre-wrap text-sm text-ink font-sans">{value || "—"}</pre>
      ) : (
        <div className="text-sm text-ink">{value || "—"}</div>
      )}
    </div>
  );
}

function formatPrice(minor: string, currency: string): string {
  // Currency-aware formatting handled lightly: assume 2dp for everything we
  // display in the dashboard. The catalog's format helper would be a better
  // long-term home for this.
  const n = Number(minor) / 100;
  if (!Number.isFinite(n)) return minor;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}
