"use client";

// Two-state density toggle for the orders list — Détaillé (default)
// shows the full row including line items; Compact hides the line
// items so the seller fits roughly twice as many rows on screen.
//
// Two pickings — preserve the customer/contact block and the action
// buttons even in compact mode, because those are the things the
// seller needs to act on a row. Only line items get hidden; they're
// only relevant when actually packing the order.
//
// Same Tailwind arbitrary-variant approach as the other filters:
// OrderRow's line-items <ul> carries `data-rich-only="true"`, and
// the compact-mode wrapper applies `[&_[data-rich-only='true']]:hidden`
// so the rule is fully literal and JIT-compiled.

import { useState } from "react";

type Density = "detailed" | "compact";

interface OrdersDensityToggleProps {
  children: React.ReactNode;
}

export function OrdersDensityToggle({
  children,
}: OrdersDensityToggleProps): React.JSX.Element {
  const [density, setDensity] = useState<Density>("detailed");
  const containerCls =
    density === "compact" ? "[&_[data-rich-only='true']]:hidden" : "";

  return (
    <>
      <div
        role="group"
        aria-label="Densité d’affichage"
        className="mb-3 inline-flex items-center gap-1 rounded-full border border-line p-0.5 self-start"
      >
        {(
          [
            ["detailed", "Détaillé"],
            ["compact", "Compact"],
          ] as ReadonlyArray<[Density, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={density === key}
            onClick={() => setDensity(key)}
            className={
              "inline-flex items-center px-3 h-7 rounded-full text-xs font-medium transition " +
              (density === key
                ? "bg-accent/15 text-accent"
                : "text-ink-mute hover:text-ink active:text-ink")
            }
          >
            {label}
          </button>
        ))}
      </div>
      <div className={containerCls}>{children}</div>
    </>
  );
}
