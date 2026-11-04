"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import { BUDGET, COMMENT_MAX, RATINGS, isNegative, type Ask, type Moment } from "@/lib/feedback";

/**
 * Small questions about one feature, asked after the viewer used it ("Is this subtitle in sync?"). Every question,
 * the big experience survey included, spends from one budget: one per viewing here, the rest on the server
 * (lib/viewer/feedback.ts). Questions only come at a calm moment and fade away by themselves if ignored.
 */

const LAST_KEY = "v-fb-last";
const OUT_KEY = "v-fb-out";
/** Set localStorage "v-fb-test" to "1" to skip the client's waits and budget (the server's budget still applies). */
const TEST_KEY = "v-fb-test";
/** No question in the first minutes of a viewing. */
const MIN_PLAYED_MS = 2 * 60_000;
/** Someone who just jumped around is looking for something, not in a mood for questions. */
const SEEK_QUIET_MS = 10_000;
const MINI_AUTOHIDE_MS = 12_000;
const THANKS_MS = 1800;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};
export const testMode = () => read(TEST_KEY) === "1";
/** Mirrors the server's gap so most viewings never make a request at all. */
const recentlyAsked = () => Date.now() - Number(read(LAST_KEY) ?? 0) < BUDGET.gapDays * 86_400_000;
const markAsked = () => write(LAST_KEY, String(Date.now()));
const optedOut = () => read(OUT_KEY) === "1";

const BUSY_KEY = "v-busy-waited";
/** The busy wait happens in the ingest screen, before this player exists: it leaves a note for the player to find. */
export const markBusyWaited = () => {
  try {
    sessionStorage.setItem(BUSY_KEY, String(Date.now()));
  } catch {}
};
/** True once, if this tab got through a busy wait in the last few minutes. */
export const takeBusyWaited = () => {
  try {
    const at = Number(sessionStorage.getItem(BUSY_KEY) ?? 0);
    sessionStorage.removeItem(BUSY_KEY);
    return Date.now() - at < 10 * 60_000;
  } catch {
    return false;
  }
};

/** One question per viewing, shared by the experience survey and the small questions. */
export type Viewing = RefObject<{ asked: boolean }>;
type Context = Record<string, string | number | boolean | null>;

/** Asks the server whether to ask something now; marks the budget used when it says yes. */
export async function requestAsk(viewing: Viewing, moment: Moment, media: { key: string; title: string }, context: Context): Promise<Ask | null> {
  if (viewing.current.asked || (!testMode() && (recentlyAsked() || optedOut()))) return null;
  try {
    const res = await fetchWithRefresh("/api/me/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moment, mediaKey: media.key, title: media.title, context }) });
    const ask = res.ok ? ((await res.json()) as { ask: Ask | null }).ask : null;
    if (!ask || viewing.current.asked) return null;
    viewing.current.asked = true;
    markAsked();
    return ask;
  } catch {
    return null;
  }
}

export function reportAsk(id: string, body: { value?: number; reasons?: string[]; comment?: string; outcome?: "ignored" }) {
  void fetchWithRefresh(`/api/me/ask/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
}

/** Marks a question ignored when it leaves the screen unanswered (closed, faded, or the viewer moved on). */
export function useIgnoredOnLeave(id: string | null) {
  const answered = useRef(false);
  useEffect(() => {
    if (!id) return;
    answered.current = false;
    return () => {
      if (!answered.current) reportAsk(id, { outcome: "ignored" });
    };
  }, [id]);
  return answered;
}

export async function setOptOut(value: boolean) {
  write(OUT_KEY, value ? "1" : "0");
  await fetchWithRefresh("/api/me/feedback-prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ optedOut: value }) }).catch(() => {});
}

/**
 * Schedules moments and asks at the first calm moment after each one is due. `afterPlayMs` counts real playing
 * time from when the moment fires (pauses and stalls do not count).
 */
export function useFeedbackMoments({ mediaKey, title, viewing, calm, context }: { mediaKey: string; title: string; viewing: Viewing; calm: () => boolean; context: () => Context }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const played = useRef(0);
  const lastTick = useRef<number | null>(null);
  const lastSeek = useRef(0);
  const asking = useRef(false);
  const pending = useRef(new Map<Moment, { due: number; context: Context }>());
  const latest = useRef({ calm, context });
  useEffect(() => {
    latest.current = { calm, context };
  });

  const moment = useCallback((name: Moment, opts: { afterPlayMs?: number; context?: Context } = {}) => {
    if (viewing.current.asked || pending.current.has(name)) return;
    pending.current.set(name, { due: played.current + (testMode() ? 0 : (opts.afterPlayMs ?? 0)), context: opts.context ?? {} });
  }, [viewing]);

  const consider = useCallback(async () => {
    if (asking.current || viewing.current.asked || !pending.current.size) return;
    if (!testMode() && (played.current < MIN_PLAYED_MS || Date.now() - lastSeek.current < SEEK_QUIET_MS)) return;
    const due = [...pending.current].find(([, p]) => played.current >= p.due);
    if (!due || !latest.current.calm()) return;
    const [name, p] = due;
    pending.current.delete(name);
    asking.current = true;
    const got = await requestAsk(viewing, name, { key: mediaKey, title }, { ...latest.current.context(), ...p.context });
    asking.current = false;
    if (got) setAsk(got);
  }, [mediaKey, title, viewing]);

  /** Call on every time update with whether the video is really playing (not stalled or seeking). */
  const onTime = useCallback((playing: boolean) => {
    const now = Date.now();
    if (playing && lastTick.current !== null) played.current += Math.min(now - lastTick.current, 2000);
    lastTick.current = playing ? now : null;
    if (playing) void consider();
  }, [consider]);
  const onSeek = useCallback(() => {
    lastSeek.current = Date.now();
  }, []);

  const card = ask ? <QuickQuestion key={ask.id} ask={ask} onDone={() => setAsk(null)} /> : null;
  return { moment, onTime, onSeek, card };
}

/** One tap to answer; a 👎 (or a low face) opens a few reasons. Never takes focus from the video. */
function QuickQuestion({ ask, onDone }: { ask: Ask; onDone: () => void }) {
  const [step, setStep] = useState<"ask" | "why" | "thanks">("ask");
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const touched = useRef(false);
  const answeredRef = useIgnoredOnLeave(ask.id);

  useEffect(() => {
    if (step !== "ask") return;
    const t = setTimeout(() => !touched.current && onDone(), MINI_AUTOHIDE_MS);
    return () => clearTimeout(t);
  }, [step, onDone]);
  useEffect(() => {
    if (step !== "thanks") return;
    const t = setTimeout(onDone, THANKS_MS);
    return () => clearTimeout(t);
  }, [step, onDone]);

  const answer = (value: number) => {
    answeredRef.current = true;
    reportAsk(ask.id, { value });
    setStep(isNegative(ask.kind, value) && ask.reasons.length ? "why" : "thanks");
  };
  const send = () => {
    if (reasons.length || comment.trim()) reportAsk(ask.id, { reasons, comment: comment.trim() });
    setStep("thanks");
  };
  const stop = () => {
    void setOptOut(true);
    onDone();
  };
  const toggle = (r: string) => setReasons((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  return (
    <div
      className="v-ask"
      data-step={step}
      role="dialog"
      aria-label={ask.prompt}
      onPointerDown={() => (touched.current = true)}
      onFocus={() => (touched.current = true)}
      onKeyDown={(e) => {
        touched.current = true;
        // Keep player shortcuts (f, m, k, arrows) from firing while choosing or typing.
        e.stopPropagation();
        if (e.key === "Escape") onDone();
      }}
    >
      {step === "ask" && (
        <>
          <div className="v-ask-head">
            <strong className="v-ask-title">{ask.prompt}</strong>
            {ask.kind === "thumbs" && (
              <span className="v-ask-thumbs" role="group" aria-label="Answer">
                <button type="button" className="v-ask-btn" aria-label="Yes" title="Yes" onClick={() => answer(1)}><span aria-hidden="true">👍</span></button>
                <button type="button" className="v-ask-btn" aria-label="No" title="No" onClick={() => answer(0)}><span aria-hidden="true">👎</span></button>
              </span>
            )}
            <button type="button" className="v-banner-x" aria-label="Close" onClick={onDone}>×</button>
          </div>
          {ask.kind === "faces" && (
            <div className="v-ask-faces" role="group" aria-label="Answer">
              {RATINGS.map((r) => (
                <button key={r.value} type="button" className="v-ask-btn" aria-label={r.label} title={r.label} onClick={() => answer(r.value)}><span aria-hidden="true">{r.emoji}</span></button>
              ))}
            </div>
          )}
          <button type="button" className="v-ask-stop" onClick={stop}>Don’t ask me questions</button>
        </>
      )}
      {step === "why" && (
        <>
          <div className="v-ask-head">
            <strong className="v-ask-title">Sorry about that. What was wrong?</strong>
            <button type="button" className="v-banner-x" aria-label="Close" onClick={onDone}>×</button>
          </div>
          <div className="v-fb-chips" role="group" aria-label="Reasons">
            {ask.reasons.map((r) => (
              <button key={r} type="button" className="v-fb-chip" aria-pressed={reasons.includes(r)} onClick={() => toggle(r)}>{r}</button>
            ))}
          </div>
          <label className="v-fb-comment">
            <span className="sr-only">Anything else? (optional)</span>
            <textarea rows={2} maxLength={COMMENT_MAX} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything else? (optional)" />
          </label>
          <div className="v-fb-actions">
            <button type="button" className="v-btn v-btn-primary" onClick={send}>{reasons.length || comment.trim() ? "Send" : "Done"}</button>
          </div>
        </>
      )}
      {step === "thanks" && (
        <p className="v-fb-thanks" role="status"><span aria-hidden="true">🙏</span> Thanks, that helps!</p>
      )}
    </div>
  );
}
