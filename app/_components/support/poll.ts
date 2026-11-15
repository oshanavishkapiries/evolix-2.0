"use client";
import { useEffect, useRef } from "react";

/** Shared scheduler; short chat polling intervals remain independent of the focus throttle. */
export function startVisiblePoll(callback: () => Promise<void>, delay: number, initial = true) {
  let busy = false;
  let stopped = false;
  let lastStarted = initial ? -Infinity : Date.now();
  const run = async (returning = false) => {
    if (stopped || document.visibilityState === "hidden" || busy || (returning && Date.now() - lastStarted < 15000)) return;
    lastStarted = Date.now();
    busy = true;
    try { await callback(); } finally { busy = false; }
  };
  const onReturn = () => { void run(true); };
  if (initial) void run();
  const timer = setInterval(() => void run(), delay);
  document.addEventListener("visibilitychange", onReturn);
  window.addEventListener("focus", onReturn);
  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onReturn);
    window.removeEventListener("focus", onReturn);
  };
}

/** One in-flight poll, no hidden-tab traffic, and focus/visibility bursts throttled to 15s. */
export function useVisiblePoll(callback: () => Promise<void>, delay: number, initial = true) {
  const latest = useRef(callback);
  useEffect(() => { latest.current = callback; });
  useEffect(() => startVisiblePoll(() => latest.current(), delay, initial), [delay, initial]);
}
