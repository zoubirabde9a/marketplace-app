"use client";

// Google Identity Services sign-in. Uses the `google.accounts.id` global,
// loaded from the Google-hosted gsi/client script. On a successful response
// we POST the idToken to /api/seller/session, which exchanges it for a
// marketplace session JWT and stores it as an httpOnly cookie.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface GoogleAccountsId {
  initialize: (cfg: {
    client_id: string;
    callback: (resp: { credential?: string }) => void;
    auto_select?: boolean;
    ux_mode?: "popup" | "redirect";
  }) => void;
  renderButton: (
    el: HTMLElement,
    cfg: { theme?: string; size?: string; text?: string; shape?: string; width?: number },
  ) => void;
  prompt: () => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

export interface GoogleSignInButtonProps {
  clientId: string;
  /** Where to POST the idToken. Defaults to the unified /api/auth/session. */
  apiPath?: string;
  /** Where to redirect after a successful sign-in. Defaults to "/". */
  nextHref?: string;
}

export function GoogleSignInButton({
  clientId,
  apiPath = "/api/auth/session",
  nextHref = "/",
}: GoogleSignInButtonProps) {
  const router = useRouter();
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const onLoad = () => {
      if (cancelled || !window.google || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp) => {
          if (!resp.credential) {
            setError("No credential returned from Google.");
            return;
          }
          setBusy(true);
          setError(null);
          try {
            const r = await fetch(apiPath, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ idToken: resp.credential }),
            });
            const json = (await r.json()) as { ok: boolean; error?: string };
            if (!r.ok || !json.ok) {
              setError(json.error ?? `Sign-in failed (HTTP ${r.status})`);
              setBusy(false);
              return;
            }
            router.push(nextHref);
            router.refresh();
          } catch (e) {
            setError((e as Error).message || "network_error");
            setBusy(false);
          }
        },
        ux_mode: "popup",
        auto_select: false,
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "filled_black",
        size: "large",
        text: "signin_with",
        shape: "pill",
        width: 320,
      });
    };

    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (window.google) onLoad();
      else existing.addEventListener("load", onLoad);
    } else {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.addEventListener("load", onLoad);
      document.head.appendChild(s);
    }
    return () => {
      cancelled = true;
    };
  }, [clientId, router]);

  return (
    <div>
      <div ref={buttonRef} aria-busy={busy} />
      {busy && <p className="mt-3 text-sm text-ink-soft">Completing sign-in…</p>}
      {error && (
        <p className="mt-3 text-sm text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
