/** Stop after six consecutive failures; a successful request starts a fresh budget. */
export function retryDelay(failures: number, initialDelay = 1200): number | null {
  return failures >= 6 ? null : Math.min(initialDelay * 2 ** Math.max(0, failures - 1), 10_000);
}
export function pollDelay(visibleDelay: number, hidden: boolean): number {
  return hidden ? Math.max(10_000, visibleDelay) : visibleDelay;
}
export function abortableDelay(ms: number, signal: AbortSignal, wake?: { target: EventTarget; isReady: () => boolean }): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      wake?.target.removeEventListener("visibilitychange", onWake);
    };
    const done = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(signal.reason); };
    const onWake = () => { if (wake?.isReady()) done(); };
    const timer = setTimeout(done, ms);
    if (signal.aborted) abort();
    else {
      signal.addEventListener("abort", abort, { once: true });
      wake?.target.addEventListener("visibilitychange", onWake);
    }
  });
}
