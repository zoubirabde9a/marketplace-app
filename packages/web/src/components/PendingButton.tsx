"use client";

// Generic submit button that reads `useFormStatus()` so the caller form
// gets a disabled + aria-busy submit while its server action is in flight.
// Used on cart line +/-/remove buttons where pending feedback matters but
// the buttons don't need bespoke "in flight" labels (the row re-render after
// the action is fast enough that a label swap would just flicker).
//
// `disabled` is OR'd with the in-flight pending flag so the caller still
// controls the qty bounds (l.qty <= 1, l.qty >= 99) the same way.

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function PendingButton({
  disabled,
  ariaLabel,
  className,
  children,
}: {
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      aria-label={ariaLabel}
      className={className}
    >
      {children}
    </button>
  );
}
