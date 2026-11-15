/** Browser-independent scheduler so visibility, cleanup and in-flight behavior can be tested. */
export type VisibilitySource = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
export function startVisibleInterval(callback: () => unknown | Promise<unknown>, delay: number, initial = true, visibility: VisibilitySource = document) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let busy = false;
  let refreshPending = false;
  const visible = () => visibility.visibilityState !== "hidden";
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const schedule = (ms: number) => { clear(); if (!stopped && visible()) timer = setTimeout(() => void run(), ms); };
  const run = async () => {
    if (stopped || !visible()) return;
    if (busy) { refreshPending = true; return; }
    busy = true;
    refreshPending = false;
    try { await callback(); } catch { /* Each consumer owns its error UI; keep future polls alive. */ }
    finally {
      busy = false;
      schedule(refreshPending ? 0 : delay);
    }
  };
  const onVisibility = () => {
    clear();
    if (visible()) void run();
  };
  visibility.addEventListener("visibilitychange", onVisibility);
  schedule(initial ? 0 : delay);
  return () => { stopped = true; clear(); visibility.removeEventListener("visibilitychange", onVisibility); };
}

/** Used by bounded action/retry loops as well as periodic polling. */
export function waitUntilVisible(visibility: VisibilitySource = document): Promise<void> {
  if (visibility.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve) => {
    const onVisibility = () => {
      if (visibility.visibilityState === "hidden") return;
      visibility.removeEventListener("visibilitychange", onVisibility);
      resolve();
    };
    visibility.addEventListener("visibilitychange", onVisibility);
  });
}
