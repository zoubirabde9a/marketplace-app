import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, syntheticAgentId } from "@/lib/sellerSession";
import { listMySellers } from "@/lib/api";
import { ContactForm } from "./ContactForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Seller contact",
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
      <section className="pt-10 pb-24 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold">Edit contact info</h1>
        <p className="mt-4 text-sm text-ink-soft">
          No seller profile found.{" "}
          <Link href="/seller/dashboard" className="text-accent hover:underline">
            Back to dashboard
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="pt-10 pb-24 max-w-2xl mx-auto">
      <Link href="/seller/dashboard" className="text-sm text-ink-soft hover:text-ink">
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Edit contact info</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Updating <span className="text-ink">{seller.displayName}</span>{" "}
        <span className="text-ink-mute font-mono text-xs">({seller.sellerId})</span>
      </p>
      <div className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-6">
        <ContactForm
          sellerId={seller.sellerId}
          initial={{
            phone: seller.phone ?? "",
            whatsapp: seller.whatsapp ?? "",
            website: seller.website ?? "",
          }}
        />
      </div>
      <p className="mt-4 text-xs text-ink-mute">
        Note: the API supports phone, WhatsApp, and website only. Display-name
        renames and supportEmail/supportUrl are not currently exposed by{" "}
        <code className="font-mono">PATCH /v1/sellers/:id</code> and are
        skipped here.
      </p>
    </section>
  );
}
