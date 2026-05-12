import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, syntheticAgentId } from "@/lib/sellerSession";
import { listMySellers } from "@/lib/api";
import { NewProductForm } from "./NewProductForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // French chrome on the seller-facing money path to match the buyer side
  // (cart/checkout/order) and og:locale=fr_DZ. The "Vendre" button in the
  // global header lands here; English copy here read as half-finished.
  title: "Nouveau produit",
  robots: { index: false, follow: false },
};

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ sellerId?: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/seller");
  const params = await searchParams;

  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(session.jwt, agentId);
  const sellers = sellersResp.data;

  if (sellers.length === 0) {
    return (
      <section className="pt-10 pb-24 max-w-2xl mx-auto" lang="fr">
        <h1 className="text-2xl font-semibold">Nouveau produit</h1>
        <p className="mt-4 text-sm text-ink-soft">
          Vous devez d’abord créer une boutique.{" "}
          <Link href="/seller/dashboard" className="text-accent hover:underline">
            Aller au tableau de bord
          </Link>
          .
        </p>
      </section>
    );
  }

  const defaultSellerId = params.sellerId && sellers.some((s) => s.sellerId === params.sellerId)
    ? params.sellerId
    : sellers[0]!.sellerId;

  return (
    <section className="pt-10 pb-24 max-w-2xl mx-auto" lang="fr">
      <Link href="/seller/dashboard" className="text-sm text-ink-soft hover:text-ink">
        ← Retour au tableau de bord
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Nouveau produit</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Ajoutez une annonce. Vous pouvez définir une variante initiale ; d’autres variantes pourront être ajoutées plus tard depuis la page d’édition du produit.
      </p>
      <div className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-6">
        <NewProductForm
          sellers={sellers.map((s) => ({ sellerId: s.sellerId, displayName: s.displayName }))}
          defaultSellerId={defaultSellerId}
        />
      </div>
    </section>
  );
}
