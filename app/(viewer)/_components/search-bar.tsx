"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { SEARCH_MIN_CHARS, useDebouncedValue } from "@/lib/client/use-debounced";

/** Search page input: 400 ms debounce, then ?q= is updated and the server re-renders the results. */
export function SearchBar({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  const [debounced, flush] = useDebouncedValue(trimmed);
  const [pending, start] = useTransition();
  const applied = useRef(initial.trim());

  // Cleared or >= 2 chars are applied; a single character leaves the previous results alone.
  const term = debounced.length >= SEARCH_MIN_CHARS ? debounced : debounced === "" ? "" : null;

  useEffect(() => {
    if (term === null || term === applied.current) return;
    applied.current = term;
    const next = new URLSearchParams(params);
    if (term) next.set("q", term);
    else next.delete("q");
    next.delete("page");
    const qs = next.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }, [term, params, pathname, router]);

  return (
    <div role="search" className="v-searchbar">
      <label className="v-sr" htmlFor="search-q">Search movies and shows</label>
      <input
        id="search-q"
        type="search"
        value={value}
        placeholder="Search movies and shows"
        autoComplete="off"
        autoFocus={!initial}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            flush(trimmed);
          }
        }}
        aria-describedby="search-hint"
      />
      {pending && <span className="v-spin" aria-hidden="true" />}
      <p id="search-hint" className="v-muted" style={{ fontSize: ".8rem", marginTop: ".35rem", minHeight: "1.2rem" }} aria-live="polite">
        {trimmed.length > 0 && trimmed.length < SEARCH_MIN_CHARS ? `Type at least ${SEARCH_MIN_CHARS} characters to search.` : pending ? "Searching..." : ""}
      </p>
    </div>
  );
}
