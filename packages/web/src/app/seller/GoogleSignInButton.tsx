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
            setError("Aucune information reçue de Google. Réessayez.");
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
              // Log the technical error code/message server-side for ops,
              // show the buyer a clean French line instead of dumping the
              // raw API error string ("user_revoked", "token_expired", etc.)
              // into a form they're trying to retry on.
              if (typeof console !== "undefined") {
                console.error("[google-signin] api_failed", { status: r.status, error: json.error });
              }
              setError("Connexion impossible. Réessayez dans un instant.");
              setBusy(false);
              return;
            }
            router.push(nextHref);
            router.refresh();
          } catch (e) {
            if (typeof console !== "undefined") {
              console.error("[google-signin] network_error", (e as Error).message);
            }
            setError("Connexion impossible. Vérifiez votre réseau, puis réessayez.");
            setBusy(false);
          }
        },
        ux_mode: "popup",
        auto_select: false,
      });
      // Google's renderButton takes a fixed pixel width (range 200–400). Hard-
      // coding 320 overflowed the seller-card on phones at ≤360px viewports
      // (the card has p-5 = 40px of inner padding plus the layout's px-3
      // gutter, so available width is ~296px on a typical iPhone SE).
      // Read the actual container width and clamp into Google's accepted
      // range so the button never bleeds past its parent.
      const containerWidth = buttonRef.current.parentElement?.clientWidth
        ?? buttonRef.current.clientWidth
        ?? 320;
      const buttonWidth = Math.max(200, Math.min(400, Math.floor(containerWidth)));
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "filled_black",
        size: "large",
        text: "signin_with",
        shape: "pill",
        width: buttonWidth,
      });
    };

    const onError = () => {
      if (cancelled) return;
      setError(
        "Couldn’t load Google Sign-In. This usually means the network is blocking accounts.google.com — try a different network or disable a script blocker.",
      );
    };

    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (window.google) onLoad();
      else {
        existing.addEventListener("load", onLoad);
        existing.addEventListener("error", onError);
      }
    } else {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.addEventListener("load", onLoad);
      s.addEventListener("error", onError);
      document.head.appendChild(s);
    }
    return () => {
      cancelled = true;
    };
  }, [clientId, router]);

  return (
    <div>
      <div ref={buttonRef} aria-busy={busy} />
      {busy && <p className="mt-3 text-sm text-ink-soft">Connexion en cours…</p>}
      {error && (
        <p className="mt-3 text-sm text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
