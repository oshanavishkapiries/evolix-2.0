import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVisibleInterval, waitUntilVisible, type VisibilitySource } from "@/lib/client/visible-interval";

describe("visible interval scheduling", () => {
  let source: EventTarget & { visibilityState: DocumentVisibilityState };
  let stop: (() => void) | undefined;
  const hide = () => { source.visibilityState = "hidden"; source.dispatchEvent(new Event("visibilitychange")); };
  const show = () => { source.visibilityState = "visible"; source.dispatchEvent(new Event("visibilitychange")); };
  const start = (callback: () => unknown, initial = true) => { stop = startVisibleInterval(callback, 1000, initial, source as VisibilitySource); };
  beforeEach(() => { vi.useFakeTimers(); source = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState }); });
  afterEach(() => { stop?.(); vi.useRealTimers(); });
  it("defers initial work, removes hidden timers and refreshes immediately on return", async () => {
    const callback = vi.fn(); start(callback);
    expect(callback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0); expect(callback).toHaveBeenCalledTimes(1);
    hide(); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000); expect(callback).toHaveBeenCalledTimes(1);
    show(); expect(callback).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000); expect(callback).toHaveBeenCalledTimes(3);
  });
  it("does not initially load server-provided data or start hidden work", async () => {
    const callback = vi.fn(); hide(); start(callback, false);
    await vi.advanceTimersByTimeAsync(5000); expect(callback).not.toHaveBeenCalled();
    show(); expect(callback).toHaveBeenCalledTimes(1);
  });
  it("serializes requests and follows a visibility return with a fresh request", async () => {
    let resolve!: () => void;
    const callback = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { resolve = r; }));
    start(callback); await vi.advanceTimersByTimeAsync(0);
    hide(); show(); expect(callback).toHaveBeenCalledTimes(1);
    resolve(); await vi.advanceTimersByTimeAsync(0); expect(callback).toHaveBeenCalledTimes(2);
  });
  it("cleans up listeners and never reschedules an in-flight request after disposal", async () => {
    let resolve!: () => void;
    const callback = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    start(callback); await vi.advanceTimersByTimeAsync(0); stop?.(); resolve();
    await vi.advanceTimersByTimeAsync(5000); hide(); show();
    expect(callback).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("suspends a bounded action retry until the tab returns", async () => {
    hide();
    const resumed = vi.fn();
    const waiting = waitUntilVisible(source as VisibilitySource).then(resumed);
    await vi.advanceTimersByTimeAsync(5000); expect(resumed).not.toHaveBeenCalled();
    show(); await waiting; expect(resumed).toHaveBeenCalledOnce();
    await expect(waitUntilVisible(source as VisibilitySource)).resolves.toBeUndefined();
  });
  it("recovers from callback failures", async () => {
    const callback = vi.fn().mockRejectedValueOnce(new Error("offline")); start(callback);
    await vi.advanceTimersByTimeAsync(1000); expect(callback).toHaveBeenCalledTimes(2);
  });
});
