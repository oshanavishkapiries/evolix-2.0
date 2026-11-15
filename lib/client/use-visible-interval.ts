"use client";
import { useEffect, useRef } from "react";
import { startVisibleInterval } from "./visible-interval";

/** No hidden-tab timers or overlapping requests; refresh immediately when visible again. */
export function useVisibleInterval(callback: () => unknown | Promise<unknown>, delay: number | null, initial = true, resetKey?: unknown) {
  const latest = useRef(callback);
  useEffect(() => { latest.current = callback; });
  useEffect(() => {
    if (delay === null) return;
    return startVisibleInterval(() => latest.current(), delay, initial);
  }, [delay, initial, resetKey]);
}
