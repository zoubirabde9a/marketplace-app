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
        className="px-3 py-1.5 rounded-md text-sm font-medium text-ink-soft hover:text-ink hover:bg-bg-elev transition"
      >
        Se connecter
      </Link>
    );
  }
  const display = me.user.displayName ?? me.user.email;
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/dashboard"
        className="text-xs text-ink-soft hidden sm:inline truncate max-w-[20ch] hover:text-ink transition"
        title={me.user.email}
      >
        {display}
      </Link>
      <SignOutButton />
    </div>
  );
}
