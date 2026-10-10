"use client";

import { useOptimistic, useTransition } from "react";

/**
 * Toggle switch with optimistic update. `onToggle` resolves true on success; when it resolves
 * false the optimistic value is rolled back (the parent keeps the old `checked`).
 */
export function Switch({
  checked,
  onToggle,
  label,
  onLabel,
  offLabel,
}: {
  checked: boolean;
  onToggle: (next: boolean) => Promise<boolean>;
  /** Accessible name. */
  label: string;
  onLabel?: string;
  offLabel?: string;
}) {
  const [value, setValue] = useOptimistic(checked);
  const [pending, start] = useTransition();
  const text = value ? onLabel : offLabel;
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        aria-busy={pending}
        disabled={pending}
        className="switch"
        onClick={() =>
          start(async () => {
            setValue(!value);
            await onToggle(!value);
          })
        }
      >
        <span className="switch-knob" aria-hidden="true" />
      </button>
      {text && <span className="text-sm">{text}</span>}
    </span>
  );
}
