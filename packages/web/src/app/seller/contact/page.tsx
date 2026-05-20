import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, syntheticAgentId } from "@/lib/sellerSession";
import { listMySellers } from "@/lib/api";
import { ContactForm } from "./ContactForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // French chrome to match the rest of the seller surface (dashboard,
  // products/new) and the buyer money path.
  title: "Coordonnées de la boutique",
  robots: { index: false, follow: false },
};

export default async function ContactPage({
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

  const seller = params.sellerId
    ? sellers.find((s) => s.sellerId === params.sellerId)
    : sellers[0];

  if (!seller) {
    return (
      <section aria-labelledby="contact-edit-heading" className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-2xl mx-auto" lang="fr">
        <h1 id="contact-edit-heading" className="text-2xl font-semibold">Modifier les coordonnées</h1>
        <p className="mt-4 text-sm text-ink-soft">
          Aucune boutique trouvée.{" "}
          <Link href="/seller/dashboard" className="text-accent hover:underline active:underline">
            Retour au tableau de bord
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="contact-edit-heading" className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-2xl mx-auto" lang="fr">
      <Link href="/seller/dashboard" className="inline-flex items-center h-8 text-sm text-ink-soft hover:text-ink active:text-ink">
        <span aria-hidden>←</span> Retour au tableau de bord
      </Link>
      <h1 id="contact-edit-heading" className="mt-3 text-2xl font-semibold tracking-tight">Modifier les coordonnées</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Boutique : <span dir="auto" className="text-ink">{seller.displayName}</span>
      </p>
      {/* All fields are nullable in the API — sellers don't have to set
          phone + WhatsApp + website all at once. State this upfront so
          they don't feel obligated to fill every input before saving. */}
      <p className="mt-1 text-xs text-ink-mute">
        Tous les champs sont optionnels — laissez vide ce que vous ne souhaitez pas afficher.
      </p>
      <div className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-6">
        <ContactForm
          sellerId={seller.sellerId}
          initial={{
            phone: seller.phone ?? "",
            whatsapp: seller.whatsapp ?? "",
            website: seller.website ?? "",
          }}
        />
      </div>
      <footer className="mt-4 text-xs text-ink-mute">
        Le nom de la boutique et l’e-mail de support ne sont pas encore modifiables —{" "}
        {/* mailto link instead of bare "contactez-nous" so sellers can
            actually act on the instruction with one tap. Subject is
            pre-filled with the seller name so the support inbox knows
            which shop the request is about. */}
        <a
          href={`mailto:mahlledz@gmail.com?subject=${encodeURIComponent(
            `Modification de boutique : ${seller.displayName}`,
          )}&body=${encodeURIComponent(
            `Bonjour,\n\nJe souhaite modifier la boutique « ${seller.displayName} ». Changement demandé :\n\n`,
          )}`}
          className="text-accent hover:underline active:underline"
        >
          contactez-nous
        </a>{" "}
        si vous devez les changer.
      </footer>
    </section>
  );
}
