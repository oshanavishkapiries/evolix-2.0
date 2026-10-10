"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronIcon } from "./icons";

/** Hub row: header with arrows (hover devices) above a scroll-snap list (touch users swipe). */
export function ScrollRow({ label, head, variant = "poster", children }: { label: string; head: React.ReactNode; variant?: "poster" | "landscape"; children: React.ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft < el.scrollWidth - el.clientWidth - 8 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Cards stagger in once, the first time the row scrolls into view (spec §6.7).
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        el.dataset.in = "true";
        io.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
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
      <ul className="v-scroller" data-variant={variant} ref={ref} onScroll={update}>
        {children}
      </ul>
    </section>
  );
}
