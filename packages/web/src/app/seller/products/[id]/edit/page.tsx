import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, syntheticAgentId } from "@/lib/sellerSession";
import { getProduct, listMySellers } from "@/lib/api";
import { EditProductForm, type EditableProduct } from "./EditProductForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // French chrome to match the rest of the seller surface (dashboard,
  // products/new, contact) and the buyer money path.
  title: "Modifier le produit",
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
      <section className="pt-6 sm:pt-10 pb-24 max-w-3xl mx-auto" lang="fr">
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
  // sellers. Otherwise we treat it as not editable. The API enforces the same
  // check on every write — this is just to avoid rendering a form that will
  // 403 on save.
  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(session.jwt, agentId);
  const owns = sellersResp.data.some((s) => s.sellerId === product.sellerId);
  if (!owns) {
    return (
      <section className="pt-6 sm:pt-10 pb-24 max-w-3xl mx-auto" lang="fr">
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

  const initial: EditableProduct = {
    productId: product.productId,
    title: product.title.value,
    description: product.description?.value ?? "",
    brand: product.brand ?? "",
    categoryIds: product.categoryIds,
    variants: product.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      priceMinor: v.priceMinor,
      currency: v.currency,
      inStock: v.inStock,
    })),
    images: product.images.map((m) => ({ id: m.id, url: m.url, contentType: m.contentType })),
  };

  return (
    <section className="pt-10 pb-24 max-w-3xl mx-auto" lang="fr">
      <Link href="/seller/dashboard" className="inline-flex items-center h-8 text-sm text-ink-soft hover:text-ink">
        ← Retour au tableau de bord
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Modifier le produit</h1>

      <div className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-6">
        <EditProductForm initial={initial} />
      </div>
    </section>
  );
}
