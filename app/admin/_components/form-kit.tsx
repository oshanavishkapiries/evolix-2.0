"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormValues } from "./fields";

/** Warns before closing/reloading the tab while there are unsaved changes. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}

/** Form values plus a dirty flag against the last saved snapshot. */
export function useDirtyForm(initial: FormValues) {
  const [base, setBase] = useState(initial);
  const [values, setValues] = useState(initial);
  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(base), [values, base]);
  useUnsavedWarning(dirty);
  /** Call after a successful save with the saved values: they become the new clean snapshot. */
  const markSaved = useCallback((next: FormValues) => {
    setBase(next);
    setValues(next);
  }, []);
  const discard = useCallback(() => setValues(base), [base]);
  return { values, setValues, dirty, markSaved, discard };
}

/** Sticky save bar: Save stays disabled until something changed. */
export function SaveBar({
  dirty,
  saving,
  onDiscard,
  label = "Save changes",
  children,
}: {
  dirty: boolean;
  saving?: boolean;
  onDiscard?: () => void;
  label?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="action-bar">
      <span className="text-sm text-gray-600 dark:text-gray-400" aria-live="polite">
        {saving ? "Saving..." : dirty ? "You have unsaved changes." : "No unsaved changes."}
      </span>
      <span className="toolbar">
        {children}
        {onDiscard && (
          <button type="button" className="btn-secondary" disabled={!dirty || saving} onClick={onDiscard}>
            Discard
          </button>
        )}
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving..." : label}
        </button>
      </span>
    </div>
  );
}
