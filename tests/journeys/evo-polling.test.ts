import { afterEach, expect, it, vi } from "vitest";
import { abortableDelay, pollDelay, retryDelay } from "@/lib/evo/polling";
afterEach(() => vi.useRealTimers());
it("bounds transient retries and stretches background polling", () => {
  expect([1, 2, 3, 4, 5, 6].map(failures => retryDelay(failures))).toEqual([1200, 2400, 4800, 9600, 10000, null]);
  expect([800, 1200, 2500].map(ms => pollDelay(ms, false))).toEqual([800, 1200, 2500]);
  expect(pollDelay(800, true)).toBe(10000);
  expect(retryDelay(1)).toBe(1200); // A new request starts with a fresh failure budget.
});
it("cancels a pending retry on abort without leaving a timer", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const waiting = abortableDelay(10000, controller.signal);
  const rejected = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  await expect(abortableDelay(10000, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(vi.getTimerCount()).toBe(0);
});

it("wakes a background retry immediately on visibility and cleans up listeners", async () => {
  vi.useFakeTimers();
  const visibility = new EventTarget();
  const remove = vi.spyOn(visibility, "removeEventListener");
  let visible = false;
  const waiting = abortableDelay(10000, new AbortController().signal, { target: visibility, isReady: () => visible });
  visibility.dispatchEvent(new Event("visibilitychange"));
  expect(vi.getTimerCount()).toBe(1);
  visible = true;
  visibility.dispatchEvent(new Event("visibilitychange"));
  await waiting;
  expect(vi.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledOnce();
  expect([1, 2, 3, 6].map(failures => retryDelay(failures, 2500))).toEqual([2500, 5000, 10000, null]);
});
