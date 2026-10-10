"use client";

export const STEPS = ["Search", "Review", "Save"] as const;

/** 1 Search - 2 Review - 3 Save. `current` is 1-based. */
export function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol aria-label="Progress" className="flex flex-wrap items-center gap-2 text-sm">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={label} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            <span
              className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${
                state === "todo"
                  ? "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                  : "bg-indigo-600 text-white"
              }`}
            >
              {state === "done" ? "✓" : n}
            </span>
            <span className={state === "current" ? "font-semibold" : "text-gray-600 dark:text-gray-400"}>
              {label}
              <span className="sr-only">{state === "done" ? " (completed)" : state === "current" ? " (current step)" : ""}</span>
            </span>
            {n < STEPS.length && <span className="h-px w-6 bg-gray-300 dark:bg-gray-700" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Sticky bottom bar of the review step: Back and Save. */
export function WizardBar({ saving, saveLabel, onBack }: { saving: boolean; saveLabel: string; onBack: () => void }) {
  return (
    <div className="action-bar">
      <button type="button" className="btn-secondary" disabled={saving} onClick={onBack}>
        Back
      </button>
      <button type="submit" disabled={saving}>
        {saving ? "Saving..." : saveLabel}
      </button>
    </div>
  );
}
