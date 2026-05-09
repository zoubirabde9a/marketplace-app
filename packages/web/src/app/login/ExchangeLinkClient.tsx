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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
          setErrorMsg(json.error ?? `Exchange failed (HTTP ${r.status})`);
          setStatus("error");
          return;
        }
        setStatus("ok");
        router.push(next);
        router.refresh();
      } catch (e) {
        if (cancelled) return;
        setErrorMsg((e as Error).message || "network_error");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, next, router]);

  if (status === "working") return <p className="text-sm text-ink-soft">Exchanging your agent&rsquo;s link…</p>;
  if (status === "ok") return <p className="text-sm text-ok">Signed in — redirecting…</p>;
  return (
    <p className="text-sm text-bad" role="alert">
      Couldn&rsquo;t sign you in: {errorMsg}. The link may have expired (10 min
      TTL) or already been used. Use Google sign-in below instead.
    </p>
  );
}
