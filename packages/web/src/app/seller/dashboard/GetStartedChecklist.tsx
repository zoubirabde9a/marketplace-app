// Onboarding checklist rendered in place of the bare "Aucun produit"
// empty state when a shop has zero products. A first-time seller
// landing on the dashboard right after creating their shop saw a
// single line of text and no obvious next moves; this surfaces the
// three things they actually need to do to be open for business:
//
//   1. Contact info so buyers can reach them after an order
//   2. First product so the storefront isn't a 404
//   3. Share the public storefront URL with their network
//
// Each step is either checked off (one of phone/whatsapp/email/web
// is set; storefront has products) or rendered as a CTA pointing at
// the page that completes it. Steps after an unfinished one stay
// visible but dimmed — the seller sees the full path, not just the
// next click.

import Link from "next/link";
import { CopyIconButton } from "@/components/CopyButton";
import { SITE_URL } from "@/lib/sitemap";
import type { SellerRecord } from "@/lib/api";

interface GetStartedChecklistProps {
  seller: SellerRecord;
}

export function GetStartedChecklist({ seller }: GetStartedChecklistProps): React.JSX.Element {
  const hasContact = Boolean(
    seller.phone || seller.whatsapp || seller.supportEmail || seller.website,
  );
  // Always false in this branch (we render this only when products.length === 0)
  // but kept explicit so future re-use of the component handles the
  // post-first-product state correctly.
  const hasProduct = false;
  const storeUrl = `${SITE_URL}/store/${seller.sellerId}`;

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/5 p-5 sm:p-6">
      <h4 className="text-base font-semibold text-ink">Bien démarrer</h4>
      <p className="mt-1 text-sm text-ink-soft">
        Trois étapes pour ouvrir votre boutique aux acheteurs.
      </p>
      <ol className="mt-4 space-y-3">
        <Step
          index={1}
          done={hasContact}
          title="Renseignez vos coordonnées"
          description="Téléphone et WhatsApp pour que les acheteurs vous joignent après leur commande."
          cta={
            hasContact ? null : (
              <Link
                href={`/seller/contact?sellerId=${encodeURIComponent(seller.sellerId)}`}
                className="text-sm px-3.5 h-9 inline-flex items-center rounded-md bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition shrink-0"
              >
                Ajouter
              </Link>
            )
          }
        />
        <Step
          index={2}
          done={hasProduct}
          title="Ajoutez votre premier produit"
          description="Une annonce avec photo, titre et prix pour rendre votre boutique visible dans la recherche."
          cta={
            <Link
              href={`/seller/products/new?sellerId=${encodeURIComponent(seller.sellerId)}`}
              className="text-sm px-3.5 h-9 inline-flex items-center rounded-md bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition shrink-0"
            >
              Ajouter <span aria-hidden className="ml-1">→</span>
            </Link>
          }
        />
        <Step
          index={3}
          done={false}
          // The third step stays dim and uncopyable until step 2 is
          // done — sharing a storefront URL before any product is
          // listed sends buyers to an empty page. We surface the URL
          // but disable the copy button so the seller knows where
          // this lands once they've added something.
          dim={!hasProduct}
          title="Partagez le lien de votre boutique"
          description={
            hasProduct
              ? "Envoyez ce lien à vos clients par SMS, WhatsApp ou sur vos réseaux sociaux."
              : "Disponible après votre premier produit — vous pourrez alors envoyer ce lien à vos contacts."
          }
          cta={
            hasProduct ? (
              <span className="inline-flex items-center gap-2">
                <span
                  dir="ltr"
                  className="font-mono text-xs text-ink-soft bg-bg-elev border border-line-soft rounded px-2 py-1 max-w-[16rem] truncate"
                >
                  {storeUrl}
                </span>
                <CopyIconButton
                  value={storeUrl}
                  ariaLabel="Copier le lien public de la boutique"
                />
              </span>
            ) : null
          }
        />
      </ol>
    </div>
  );
}

interface StepProps {
  index: number;
  done: boolean;
  dim?: boolean;
  title: string;
  description: string;
  cta: React.ReactNode;
}

function Step({ index, done, dim, title, description, cta }: StepProps): React.JSX.Element {
  return (
    <li
      className={
        "flex items-start gap-3 " +
        (dim ? "opacity-60" : "")
      }
    >
      {/* Index / check badge. Filled green when done; outlined when
          pending — visually communicates progress at a glance. */}
      <span
        aria-hidden
        className={
          "shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-semibold " +
          (done
            ? "bg-ok text-bg"
            : "border border-line text-ink-soft bg-bg/60")
        }
      >
        {done ? "✓" : index}
      </span>
      <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
        <div className="min-w-0">
          <p className={"text-sm font-medium " + (done ? "text-ink line-through decoration-ink-mute decoration-1" : "text-ink")}>
            {title}
          </p>
          <p className="text-xs text-ink-soft mt-0.5">{description}</p>
        </div>
        {cta}
      </div>
    </li>
  );
}
