"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  sellerId: string;
  initial: { phone: string; whatsapp: string; website: string };
}

export function ContactForm({ sellerId, initial }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Auto-dismiss the success indicator via useEffect so the timer is
  // cleaned up if the seller navigates away mid-wait. Previously a bare
  // setTimeout would fire setState on an unmounted component (harmless
  // but noisy in dev).
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 2500);
    return () => clearTimeout(t);
  }, [success]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const phone = String(f.get("phone") ?? "").trim();
        const whatsapp = String(f.get("whatsapp") ?? "").trim();
        const website = String(f.get("website") ?? "").trim();
        // null => clear, string => set, omit (undefined) => leave unchanged.
        // We always send all three so users can clear fields by emptying them.
        const patch = {
          phone: phone === "" ? null : phone,
          whatsapp: whatsapp === "" ? null : whatsapp,
          website: website === "" ? null : website,
        };
        setError(null);
        setSuccess(null);
        start(async () => {
          let r: Response;
          try {
            r = await fetch(`/api/seller/sellers/${encodeURIComponent(sellerId)}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(patch),
            });
          } catch {
            setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
            return;
          }
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as {
              error?: string;
              detail?: string;
            };
            setError(j.detail || j.error || `Échec (HTTP ${r.status})`);
            return;
          }
          setSuccess("Enregistré");
          router.refresh();
          // Auto-dismiss is handled by the success useEffect above.
        });
      }}
      className="grid gap-4"
      lang="fr"
    >
      {/* Placeholders use an Algerian-shaped number on a DZ-primary marketplace
          — US examples ("+1 555 ...") were confusing for sellers in Alger. */}
      {/* Both placeholders share the same readable spaced format. The
          storefront renders whichever raw value the seller submits, so
          a spaced format flows visually; wa.me strips non-digits when
          building click-to-chat links so spaces don't break that path. */}
      <Field label="Téléphone" name="phone" defaultValue={initial.phone} placeholder="+213 555 12 34 56" type="tel" inputMode="tel" autoComplete="tel" />
      <Field label="WhatsApp" name="whatsapp" defaultValue={initial.whatsapp} placeholder="+213 555 12 34 56" type="tel" inputMode="tel" autoComplete="tel" />
      <Field label="Site web" name="website" defaultValue={initial.website} placeholder="https://exemple.dz" type="url" inputMode="url" autoComplete="url" />
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="self-stretch sm:self-auto inline-flex h-11 sm:h-10 px-4 items-center justify-center rounded-lg bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {success && (
          <span className="text-sm text-ok inline-flex items-center gap-1.5" role="status">
            <span aria-hidden>✓</span> {success}
          </span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  type = "text",
  inputMode,
  autoComplete,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
  inputMode?: "tel" | "url" | "email" | "numeric" | "decimal" | "text" | "search";
  autoComplete?: string;
}) {
  return (
    <label className="text-sm">
      <span className="block text-ink-soft mb-1">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-base sm:text-sm text-ink focus:border-accent/60 outline-none"
      />
    </label>
  );
}
