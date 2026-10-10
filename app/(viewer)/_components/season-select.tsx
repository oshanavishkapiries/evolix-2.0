"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ChevronIcon } from "./icons";

export type SeasonOption = { id: string; number: number; label: string; count?: number };

/** Dropdown season picker; options are real links so the selection stays in the URL. */
export function SeasonSelect({ showId, options, selectedId }: { showId: string; options: SeasonOption[]; selectedId: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const current = options.find((o) => o.id === selectedId);

  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details className="v-select" ref={ref}>
      <summary aria-label="Choose season">
        <span>{current?.label}</span>
        <ChevronIcon size={16} />
      </summary>
      <ul>
        {options.map((o) => (
          <li key={o.id}>
            <Link
              href={`/tv/${showId}?season=${o.number}`}
              aria-current={o.id === selectedId}
              replace
              scroll={false}
              onClick={() => ref.current?.removeAttribute("open")}
            >
              <span>{o.label}</span>
              {o.count !== undefined && <small>{o.count} eps</small>}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
