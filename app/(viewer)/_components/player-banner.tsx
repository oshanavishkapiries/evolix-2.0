"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** A Netflix-style notification over the video: dark panel, gold edge, optional OK action and a close button. */
export function PlayerBanner({
  place,
  title,
  text,
  action,
  onAction,
  onClose,
}: {
  place: "top" | "side";
  title: string;
  text?: string;
  action?: string;
  onAction?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="v-banner" data-place={place} role="status" aria-live="polite">
      <strong className="v-banner-title">{title}</strong>
      <button type="button" className="v-banner-x" aria-label="Close" onClick={onClose}>×</button>
      {text && <p className="v-banner-text">{text}</p>}
      {action && (
        <div className="v-banner-actions">
          <button type="button" className="v-btn v-btn-primary" onClick={onAction}>{action}</button>
        </div>
      )}
    </div>
  );
}

// Advice is only given on clear signals; a sample is taken every few seconds while the video plays.
const SAMPLE_MS = 4000;
const MIN_PLAYED_MS = 20_000;
/** Sustained throughput (Mbit/s) at which 1080p (~5 Mbit/s) has plenty of headroom. */
export const FAST_MBPS = 16;
const FAST_SAMPLES = 3;
const STALLS = 3;
const STALL_WINDOW_MS = 120_000;
const ORDER = ["1080p", "720p", "480p", "360p"];
const NEVER_KEY = "v-quality-hint";

const neverAsk = () => {
  try {
    return localStorage.getItem(NEVER_KEY) === "off";
  } catch {
    return false;
  }
};

export type Advice = { dir: "up" | "down"; to: string };

/**
 * Watches the connection and suggests a better-fitting quality once: up when throughput is far above what the
 * current quality needs, down after repeated stalls. Quality is never switched automatically. Closing the banner
 * stores "never ask again"; accepting it only ends suggestions for this viewing.
 */
export function useQualityAdvisor({
  active,
  current,
  offered,
  readMbps,
  onSwitch,
}: {
  active: boolean;
  current: () => string | null;
  offered: () => string[];
  /** Throughput estimate in Mbit/s, or null when unknown. */
  readMbps: () => number | null;
  onSwitch: (quality: string) => void;
}) {
  const [advice, setAdvice] = useState<Advice | null>(null);
  const answered = useRef(false);
  const fast = useRef(0);
  const stalls = useRef<number[]>([]);
  const playedMs = useRef(0);
  const [muted] = useState(neverAsk);
  // The caller's callbacks change every render; the interval must not, so it reads the latest ones from here.
  const latest = useRef({ current, offered, readMbps, onSwitch });
  useEffect(() => {
    latest.current = { current, offered, readMbps, onSwitch };
  });

  const consider = useCallback(() => {
    const now = latest.current.current();
    const have = latest.current.offered();
    if (!now || answered.current) return;
    const i = ORDER.indexOf(now);
    const lower = ORDER.slice(i + 1).find((q) => have.includes(q));
    const higher = [...ORDER.slice(0, i)].reverse().find((q) => have.includes(q));
    const recent = stalls.current.filter((t) => Date.now() - t < STALL_WINDOW_MS);
    stalls.current = recent;
    if (recent.length >= STALLS && lower) return setAdvice({ dir: "down", to: lower });
    if (fast.current >= FAST_SAMPLES && higher === "1080p") setAdvice({ dir: "up", to: higher });
  }, []);

  useEffect(() => {
    if (!active || muted) return;
    const t = setInterval(() => {
      playedMs.current += SAMPLE_MS;
      const mbps = latest.current.readMbps();
      fast.current = mbps !== null && mbps >= FAST_MBPS ? fast.current + 1 : 0;
      if (playedMs.current >= MIN_PLAYED_MS) consider();
    }, SAMPLE_MS);
    return () => clearInterval(t);
  }, [active, muted, consider]);

  return {
    advice: muted ? null : advice,
    /** Call on every buffering stall that was not caused by seeking. */
    noteStall: () => {
      stalls.current.push(Date.now());
    },
    accept: () => {
      answered.current = true;
      if (advice) latest.current.onSwitch(advice.to);
      setAdvice(null);
    },
    dismiss: () => {
      answered.current = true;
      try {
        localStorage.setItem(NEVER_KEY, "off");
      } catch {
        // storage blocked: the banner just will not come back this viewing
      }
      setAdvice(null);
    },
  };
}
