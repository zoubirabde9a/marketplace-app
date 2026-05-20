"use client";

// Top-of-viewport offline banner. Sellers on flaky mobile networks
// were seeing auto-refresh fail silently and order-action submits
// fail with cryptic "Connexion impossible" errors. The banner
// makes the underlying cause obvious: the device is offline, that's
// why nothing is updating.
//
// Listens to `online` / `offline` events on window. Initial state
// reads navigator.onLine on mount (it's only available client-side).
// Renders nothing when online — no chrome on the happy path.
//
// Fixed top of viewport so it sits above all other content
// regardless of scroll position; pointer-events-none on the wrapper
// so it doesn't capture clicks meant for the underlying content
// (the banner has no actions of its own).

import { useEffect, useState } from "react";

export function OfflineIndicator(): React.JSX.Element | null {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOffline(!window.navigator.onLine);
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-50 pointer-events-none flex justify-center"
    >
      <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-warn/15 border border-warn/40 text-warn px-3 h-8 text-xs font-medium backdrop-blur shadow-sm pointer-events-auto">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse"
        />
        Vous êtes hors ligne — les actualisations et actions reprendront dès le
        retour de la connexion.
      </div>
    </div>
  );
}
