"use client";

import { useId } from "react";
import { SEARCH_MIN_CHARS } from "@/lib/client/use-debounced";

/**
 * Search box for use with `useDebouncedSearch`: spinner while loading, a hint under
 * the minimum length, Enter submits immediately.
 */
export function SearchInput({
  label,
  value,
  onChange,
  onSubmit,
  loading = false,
  tooShort = false,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  loading?: boolean;
  tooShort?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const hintId = useId();
  return (
    <div role="search" className="search-input">
      <label>
        {label}
        <span className="relative block">
          <input
            type="search"
            value={value}
            placeholder={placeholder}
            autoFocus={autoFocus}
            autoComplete="off"
            aria-describedby={hintId}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit?.();
              }
            }}
          />
          {loading && <span className="spinner absolute right-3 top-1/2 -translate-y-1/2" aria-hidden="true" />}
        </span>
      </label>
      <p id={hintId} className="mt-1 min-h-5 text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
        {loading ? "Searching..." : tooShort ? `Type at least ${SEARCH_MIN_CHARS} characters to search.` : ""}
      </p>
    </div>
  );
}
