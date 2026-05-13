import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, syntheticAgentId } from "@/lib/sellerSession";
import { getProduct, listMySellers } from "@/lib/api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // French chrome to match the rest of the seller surface (dashboard,
  // products/new, contact) and the buyer money path. The page is currently
  // read-only; "Détails du produit" is more honest than "Modifier" until the
  // edit endpoints land.
  title: "Détails du produit",
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
      <section className="pt-10 pb-24 max-w-3xl mx-auto" lang="fr">
        <h1 className="text-2xl font-semibold">Modifier le produit</h1>
        <p className="mt-4 text-sm text-ink-soft">
          Produit introuvable.{" "}
          <Link href="/seller/dashboard" className="text-accent hover:underline">
            Retour au tableau de bord
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
      <section className="pt-10 pb-24 max-w-3xl mx-auto" lang="fr">
        <h1 className="text-2xl font-semibold">Modifier le produit</h1>
        <p className="mt-4 text-sm text-bad">
          Vous n’êtes pas propriétaire de ce produit.
        </p>
        <Link href="/seller/dashboard" className="mt-3 inline-block text-accent hover:underline">
          Retour au tableau de bord
        </Link>
      </section>
    );
  }

  return (
    <section className="pt-10 pb-24 max-w-3xl mx-auto" lang="fr">
      <Link href="/seller/dashboard" className="text-sm text-ink-soft hover:text-ink">
        ← Retour au tableau de bord
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Détails du produit</h1>

      <div className="mt-4 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-ink-soft">
        <strong className="text-warn">Lecture seule.</strong> La modification n’est pas encore disponible — pour changer un champ, recréez le produit.
      </div>

      <div className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-6 space-y-4">
        <Field label="Titre" value={product.title.value} />
        <Field label="Marque" value={product.brand ?? ""} />
        <Field
          label="Description"
          value={product.description?.value ?? ""}
          multiline
        />
        <Field label="Catégories" value={product.categoryIds.join(", ")} />
      </div>

      <div className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-6">
        <h2 className="text-lg font-medium">Variantes</h2>
        {product.variants.length === 0 ? (
          <p className="mt-3 text-sm text-ink-mute">Aucune variante.</p>
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
                  {v.inStock ? "en stock" : "rupture de stock"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-6">
        <h2 className="text-lg font-medium">Images</h2>
        {product.images.length === 0 ? (
          <p className="mt-3 text-sm text-ink-mute">Aucune image.</p>
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
                  alt={m.altText ?? "Image du produit"}
                  className="w-full h-full object-cover"
                />
              </li>
            ))}
          </ul>
        )}
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
