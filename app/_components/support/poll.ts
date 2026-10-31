"use client";
import { useEffect, useRef } from "react";

/** No background-tab traffic, no overlapping polls, and an immediate refresh when returning. */
export function useVisiblePoll(callback: () => Promise<void>, delay: number) {
  const latest = useRef(callback);
  useEffect(() => { latest.current = callback; });
  useEffect(() => {
    let busy = false;
    const run = async () => {
      if (document.visibilityState === "hidden" || busy) return;
      busy = true;
      try { await latest.current(); } finally { busy = false; }
    };
    void run();
    const timer = setInterval(() => void run(), delay);
    document.addEventListener("visibilitychange", run);
    window.addEventListener("focus", run);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", run); window.removeEventListener("focus", run); };
  }, [delay]);
}
