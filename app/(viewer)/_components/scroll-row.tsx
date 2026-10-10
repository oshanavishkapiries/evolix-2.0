"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronIcon } from "./icons";

/** Horizontal scroller with desktop arrows (touch users just swipe). */
export function ScrollRow({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft < el.scrollWidth - el.clientWidth - 8 });
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);

  const go = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="v-carousel">
      <button type="button" className="v-arrow v-arrow-l" onClick={() => go(-1)} hidden={!edge.left} aria-label={`Scroll ${label} left`}>
        <ChevronIcon dir="left" size={32} />
      </button>
      <button type="button" className="v-arrow v-arrow-r" onClick={() => go(1)} hidden={!edge.right} aria-label={`Scroll ${label} right`}>
        <ChevronIcon dir="right" size={32} />
      </button>
      <ul className="v-scroller" ref={ref} onScroll={update}>
        {children}
      </ul>
    </div>
  );
}
