import Link from "next/link";
import { Suspense } from "react";
import { SearchBar } from "./SearchBar";
import { HeaderUserMenu } from "./HeaderUserMenu";

export function Header() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-bg/70 border-b border-line-soft">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-6">
        <Link href="/" aria-label="Teno Store home" className="flex items-center gap-2 group shrink-0">
          <span className="relative inline-block w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-emerald-400 shadow-glow group-hover:scale-105 transition-transform" aria-hidden />
          <span className="font-semibold tracking-tight hidden sm:inline">Teno Store</span>
        </Link>
        <div className="flex-1 max-w-2xl">
          <Suspense
            fallback={
              <div
                className="h-10 rounded-xl bg-bg-soft/80 border border-line"
                role="status"
                aria-busy="true"
                aria-label="Loading search"
              />
            }
          >
            <SearchBar />
          </Suspense>
        </div>
        <nav className="ml-auto flex items-center gap-1 text-sm text-ink-soft shrink-0">
          <Link href="/search" className="hidden sm:inline-flex px-3 py-1.5 rounded-md hover:text-ink hover:bg-bg-elev transition">Browse</Link>
          <Suspense
            fallback={
              <span
                className="px-3 py-1.5 text-sm text-ink-mute"
                role="status"
                aria-busy="true"
                aria-label="Loading user menu"
              >
                <span aria-hidden>…</span>
              </span>
            }
          >
            <HeaderUserMenu />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
