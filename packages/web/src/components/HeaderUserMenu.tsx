// Server component — reads the session cookie and renders either:
//   - "Sign in" link (no session)
//   - "@displayName · Sign out" pair (session present)

import Link from "next/link";
import { getCurrentUser } from "@/lib/sellerSession";
import { SignOutButton } from "./SignOutButton";

export async function HeaderUserMenu() {
  const me = await getCurrentUser();
  if (!me) {
    return (
      <Link
        href="/login"
        aria-label="Se connecter"
        className="px-3 h-9 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-ink-soft hover:text-ink hover:bg-bg-elev active:bg-bg-elev transition"
      >
        {/* User icon — labeled with aria-label on mobile (text hidden) and
            paired with the visible label from sm: up. Keeps the SearchBar
            usably wide on phones where "Se connecter" was claiming ~85 px. */}
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        <span className="hidden sm:inline">Se connecter</span>
      </Link>
    );
  }
  const display = me.user.displayName ?? me.user.email;
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/seller/dashboard"
        className="hidden sm:inline-flex px-3 h-9 items-center rounded-md text-sm text-ink-soft hover:text-ink hover:bg-bg-elev active:bg-bg-elev transition"
        title="Gérer votre boutique"
      >
        Ma boutique
      </Link>
      <Link
        href="/dashboard"
        className="text-xs text-ink-soft hidden sm:inline truncate max-w-[20ch] hover:text-ink active:text-ink transition"
        title={me.user.email}
      >
        {display}
      </Link>
      <SignOutButton />
    </div>
  );
}
