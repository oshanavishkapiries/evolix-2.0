"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { GridIcon, RowsIcon } from "./icons";
import { CARD_SIZES, DEFAULT_SIZE, PREF_SIZE, savePref } from "./prefs";

/** Card-size slider (spec §3.2): drives --card-w through data-v-size on <html>. */
export function CardSizeSlider() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.value = document.documentElement.dataset.vSize ?? DEFAULT_SIZE;
  }, []);
  return (
    <label className="v-size">
      <span className="v-sr">Card size</span>
      <input
        ref={ref}
        type="range"
        min={1}
        max={CARD_SIZES.length}
        step={1}
        defaultValue={DEFAULT_SIZE}
        onChange={(e) => {
          document.documentElement.dataset.vSize = e.target.value;
          savePref(PREF_SIZE, e.target.value);
        }}
      />
    </label>
  );
}

/** Rows/grid toggle; the choice is remembered in a cookie so the server renders it next time. */
export function ViewToggle({ cookie, current, rowsHref, gridHref }: { cookie: string; current: "rows" | "grid"; rowsHref: string; gridHref: string }) {
  const router = useRouter();
  const pick = (mode: "rows" | "grid") => {
    document.cookie = `${cookie}=${mode}; path=/; max-age=31536000; samesite=lax`;
    router.replace(mode === "rows" ? rowsHref : gridHref, { scroll: false });
  };
  return (
    <div className="v-view-toggle" role="group" aria-label="Layout">
      <button type="button" aria-pressed={current === "rows"} aria-label="Rows" title="Rows" onClick={() => pick("rows")}>
        <RowsIcon size={18} />
      </button>
      <button type="button" aria-pressed={current === "grid"} aria-label="Grid" title="Grid" onClick={() => pick("grid")}>
        <GridIcon size={18} />
      </button>
    </div>
  );
}
