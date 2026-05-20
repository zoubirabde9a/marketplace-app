"use client";

// Calls window.print() — the browser's print dialog handles the rest.
// The page's `print:` Tailwind classes drop the nav, action buttons,
// and copy-icon chrome so the resulting paper is just the slip.
//
// Tiny client component instead of inlining onClick because the parent
// detail page is a server component; this is the bridge.

export function PrintButton(): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") window.print();
      }}
      className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center gap-2 rounded-md bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition"
    >
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7" />
        <rect x="2" y="9" width="20" height="9" rx="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 14h12v8H6z" />
      </svg>
      Imprimer
    </button>
  );
}
