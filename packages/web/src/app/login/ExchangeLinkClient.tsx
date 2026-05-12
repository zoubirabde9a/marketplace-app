"use client";

// Client-side handler for /login?code=<link-token>. POSTs to the Next.js
// route /api/auth/exchange-link, which calls the API's
// POST /v1/auth/exchange-link and stores the resulting session JWT in the
// httpOnly mp_session cookie. On success, redirect to `next` (default "/").

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function ExchangeLinkClient({ code, next }: { code: string; next: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/auth/exchange-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        if (cancelled) return;
        const json = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!r.ok || !json.ok) {
          if (typeof console !== "undefined") {
            console.error("[exchange-link] api_failed", { status: r.status, error: json.error });
          }
          setStatus("error");
          return;
        }
        setStatus("ok");
        router.push(next);
        router.refresh();
      } catch (e) {
        if (cancelled) return;
        if (typeof console !== "undefined") {
          console.error("[exchange-link] network_error", (e as Error).message);
        }
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, next, router]);

  if (status === "working") return <p className="text-sm text-ink-soft">Échange du lien en cours…</p>;
  if (status === "ok") return <p className="text-sm text-ok">Connecté — redirection…</p>;
  // Generic message — the technical reason ("expired", "already_used",
  // "network_error", a fetch stack) goes to the browser/server console.
  // Showing the raw API error to the buyer just told them what they already
  // know (it failed) while exposing internals.
  return (
    <p className="text-sm text-bad" role="alert">
      Impossible de vous connecter avec ce lien. Il a peut-être expiré (10 min) ou déjà été utilisé. Utilisez la connexion Google ci-dessous.
    </p>
  );
}
