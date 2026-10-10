import { useCallback, useEffect, useRef, useState } from "react";

export const SEARCH_DELAY_MS = 400;
export const SEARCH_MIN_CHARS = 2;

/** Value that follows `value` after `delay` ms of quiet; `flush` applies a value immediately. */
export function useDebouncedValue<T>(value: T, delay = SEARCH_DELAY_MS) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  const flush = useCallback((v: T) => setDebounced(v), []);
  return [debounced, flush] as const;
}

type SearchState<T> = { key: string; data?: T; error?: string };

export type DebouncedSearch<T> = {
  query: string;
  setQuery: (q: string) => void;
  /** Skips the wait (Enter key). */
  submit: () => void;
  data: T | null;
  error: string;
  /** A request for the current term is pending; `data` still holds the previous results. */
  loading: boolean;
  /** Typed something non-empty but below the minimum length. */
  tooShort: boolean;
  /** Settled term the current/last request is for. */
  term: string;
};

/**
 * Debounced search with stale-request cancellation. Each run aborts the previous request
 * (via the effect cleanup) and ignores its result, so out-of-order responses never win.
 * `extraKey` re-runs the search when something else (page, filter) changes.
 */
export function useDebouncedSearch<T>(
  fetcher: (term: string, signal: AbortSignal) => Promise<T>,
  opts: { initialQuery?: string; delay?: number; minChars?: number; allowEmpty?: boolean; extraKey?: string } = {},
): DebouncedSearch<T> {
  const { initialQuery = "", delay = SEARCH_DELAY_MS, minChars = SEARCH_MIN_CHARS, allowEmpty = false, extraKey = "" } = opts;
  const [query, setQuery] = useState(initialQuery);
  const trimmed = query.trim();
  const [term, flush] = useDebouncedValue(trimmed, delay);
  const [state, setState] = useState<SearchState<T> | null>(null);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const active = term.length >= minChars || (allowEmpty && term === "");
  const key = `${term}\u0000${extraKey}`;

  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const data = await fetcherRef.current(term, ctrl.signal);
        if (!ctrl.signal.aborted) setState({ key, data });
      } catch (e) {
        if (!ctrl.signal.aborted) setState({ key, error: e instanceof Error ? e.message : "Search failed" });
      }
    })();
    return () => ctrl.abort();
  }, [active, term, key]);

  const submit = useCallback(() => flush(trimmed), [flush, trimmed]);
  const cleared = trimmed === "" && !allowEmpty;

  return {
    query,
    setQuery,
    submit,
    data: cleared ? null : (state?.data ?? null),
    error: cleared ? "" : (state?.error ?? ""),
    loading: active && state?.key !== key,
    tooShort: trimmed.length > 0 && trimmed.length < minChars,
    term,
  };
}
