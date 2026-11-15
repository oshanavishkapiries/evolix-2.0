"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronIcon } from "./icons";

/** Hub row: header with arrows (hover devices) above a scroll-snap list (touch users swipe). */
export function ScrollRow({ label, head, variant = "poster", children }: { label: string; head: React.ReactNode; variant?: "poster" | "landscape" | "cast" | "video" | "shot"; children: React.ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 8;
    setEdge((previous) => previous.left === left && previous.right === right ? previous : { left, right });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hover = window.matchMedia("(hover: hover)");
    let ro: ResizeObserver | undefined;
    const track = () => {
      ro?.disconnect();
      el.removeEventListener("scroll", update);
      if (!hover.matches) return;
      ro = new ResizeObserver(update);
      ro.observe(el);
      el.addEventListener("scroll", update, { passive: true });
    };
    track();
    hover.addEventListener("change", track);
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", update);
      hover.removeEventListener("change", track);
    };
  }, [update]);

  const go = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section className="v-row" aria-label={label}>
      <div className="v-row-head">
        <div className="v-row-title">{head}</div>
        <div className="v-row-arrows">
          <button type="button" onClick={() => go(-1)} disabled={!edge.left} aria-label={`Scroll ${label} left`}>
            <ChevronIcon dir="left" size={22} />
          </button>
          <button type="button" onClick={() => go(1)} disabled={!edge.right} aria-label={`Scroll ${label} right`}>
            <ChevronIcon dir="right" size={22} />
          </button>
        </div>
      </div>
      <ul className="v-scroller" data-variant={variant} ref={ref}>
        {children}
      </ul>
    </section>
  );
}
