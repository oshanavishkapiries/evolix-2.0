"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import { COMMENT_MAX, ISSUE_TAGS, PRAISE_TAGS, RATINGS, type FeedbackTag } from "@/lib/feedback";
import { reportAsk, requestAsk, testMode, useIgnoredOnLeave, type Viewing } from "./feedback-moments";

// Who gets asked (sample, once per title) and how often (the shared budget) is decided by the server: this is the
// "experience" question in Admin -> Feedback -> Questions.
/** Minimum time actually played (this session) before asking. */
const MIN_WATCHED_MS = 8 * 60_000;
/** A pause must last this long before the survey appears (skips quick pauses and seeks). */
const PAUSE_SETTLE_MS = 2000;
/** Viewers who never pause are asked, quietly, after this much uninterrupted play. */
const LONG_PLAY_MS = 25 * 60_000;
/** The mid-play card hides itself if ignored. */
const PLAYING_AUTOHIDE_MS = 20_000;
type Trigger = "pause" | "ended" | "playing";
type Track = { kind: "movie" | "episode"; id: string };
type Context = { position: number; duration: number; quality: string | null };

/**
 * Decides when to offer the emoji survey: after real watching, at a natural moment (pause, end, or after a long
 * uninterrupted stretch). The server then decides whether this viewer is asked at all.
 */
export function usePlayerFeedback({ mediaKey, title, track, viewing, context }: { mediaKey: string; title: string; track?: Track; viewing: Viewing; context: () => Context }) {
  const [open, setOpen] = useState<{ trigger: Trigger; askId: string } | null>(null);
  const tried = useRef(false);
  const watched = useRef(0);
  const runStart = useRef<number | null>(null);
  const lastTick = useRef<number | null>(null);
  const stalls = useRef(0);
  const pauseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pauseTimer.current), []);

  const tryOpen = useCallback(
    async (trigger: Trigger) => {
      if (tried.current || viewing.current.asked) return;
      if (!testMode() && watched.current < MIN_WATCHED_MS) return;
      tried.current = true;
      const c = context();
      const ask = await requestAsk(viewing, "experience", { key: mediaKey, title }, { trigger, quality: c.quality, position: Math.round(c.position), stalls: stalls.current });
      if (ask) setOpen({ trigger, askId: ask.id });
    },
    [mediaKey, title, viewing, context],
  );

  /** Call on every time update: counts real playing time (seeks and stalls do not count). */
  const onTime = useCallback(
    (playing: boolean) => {
      const now = Date.now();
      if (playing && lastTick.current !== null) watched.current += Math.min(now - lastTick.current, 2000);
      lastTick.current = playing ? now : null;
      if (playing) {
        runStart.current ??= now;
        if (now - runStart.current >= LONG_PLAY_MS) void tryOpen("playing");
      }
    },
    [tryOpen],
  );
  const onPause = useCallback(() => {
    runStart.current = null;
    lastTick.current = null;
    clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(() => void tryOpen("pause"), PAUSE_SETTLE_MS);
  }, [tryOpen]);
  const onPlay = useCallback(() => {
    clearTimeout(pauseTimer.current);
    // A pause survey the viewer ignored makes way for the film.
    setOpen((o) => (o?.trigger === "pause" ? null : o));
  }, []);
  const onEnded = useCallback(() => {
    clearTimeout(pauseTimer.current);
    void tryOpen("ended");
  }, [tryOpen]);
  const onStall = useCallback(() => {
    stalls.current++;
  }, []);

  const close = useCallback(() => setOpen(null), []);

  const survey = open ? <FeedbackCard key={open.askId} askId={open.askId} trigger={open.trigger} title={title} mediaKey={mediaKey} track={track} context={context} stalls={() => stalls.current} onClose={close} /> : null;
  return { survey, onTime, onPause, onPlay, onEnded, onStall };
}

function FeedbackCard({
  askId,
  trigger,
  title,
  mediaKey,
  track,
  context,
  stalls,
  onClose,
}: {
  askId: string;
  trigger: Trigger;
  title: string;
  mediaKey: string;
  track?: Track;
  context: () => Context;
  stalls: () => number;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"ask" | "more" | "thanks">("ask");
  const [rating, setRating] = useState<number | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const touched = useRef(false);
  const first = useRef<HTMLButtonElement>(null);
  const answeredRef = useIgnoredOnLeave(askId);

  // Keyboard users land on the faces; the mid-play card does not steal focus from the video.
  useEffect(() => {
    if (trigger !== "playing") first.current?.focus({ preventScroll: true });
  }, [trigger]);
  useEffect(() => {
    if (trigger !== "playing") return;
    const t = setTimeout(() => !touched.current && onClose(), PLAYING_AUTOHIDE_MS);
    return () => clearTimeout(t);
  }, [trigger, onClose]);
  useEffect(() => {
    if (step !== "thanks") return;
    const t = setTimeout(onClose, 2200);
    return () => clearTimeout(t);
  }, [step, onClose]);

  const pick = async (value: number) => {
    touched.current = true;
    answeredRef.current = true;
    setRating(value);
    setStep("more");
    reportAsk(askId, { value });
    if (id) {
      void fetchWithRefresh(`/api/me/feedback/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: value }) }).catch(() => {});
      return;
    }
    const c = context();
    try {
      const res = await fetchWithRefresh("/api/me/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaKey, title, rating: value, track, position: c.position, duration: c.duration, quality: c.quality, stalls: stalls(), trigger }),
      });
      if (res.ok) setId(((await res.json()) as { id: string }).id);
    } catch {}
  };

  const send = async () => {
    if (id && (tags.length || comment.trim())) {
      setBusy(true);
      await fetchWithRefresh(`/api/me/feedback/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags, comment: comment.trim() }) }).catch(() => {});
      setBusy(false);
    }
    setStep("thanks");
  };

  const choices = (rating ?? 5) <= 3 ? ISSUE_TAGS : PRAISE_TAGS;
  const toggle = (t: FeedbackTag) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const chosen = RATINGS.find((r) => r.value === rating);

  return (
    <div
      className="v-fb"
      data-step={step}
      role="dialog"
      aria-label="Rate your watching experience"
      onPointerDown={() => (touched.current = true)}
      onKeyDown={(e) => {
        touched.current = true;
        // Keep player shortcuts (f, m, k, arrows) from firing while typing or choosing.
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <button type="button" className="v-banner-x v-fb-x" aria-label="Close" onClick={onClose}>
        ×
      </button>
      {step === "ask" && (
        <>
          <strong className="v-fb-title">How&apos;s your watching experience?</strong>
          <p className="v-fb-sub">Picture, sound and smoothness so far.</p>
          <div className="v-fb-faces" role="group" aria-label="Rating">
            {RATINGS.map((r, i) => (
              <button key={r.value} ref={i === 0 ? first : undefined} type="button" className="v-fb-face" onClick={() => void pick(r.value)} aria-label={r.label} title={r.label}>
                <span aria-hidden="true">{r.emoji}</span>
                <small>{r.label}</small>
              </button>
            ))}
          </div>
        </>
      )}
      {step === "more" && (
        <>
          <strong className="v-fb-title">
            <span className="v-fb-picked" aria-hidden="true">{chosen?.emoji}</span>
            {(rating ?? 5) <= 3 ? "Sorry about that. What went wrong?" : "Glad to hear it! What did you like?"}
          </strong>
          <div className="v-fb-chips" role="group" aria-label="Details">
            {(Object.entries(choices) as [FeedbackTag, string][]).map(([k, label]) => (
              <button key={k} type="button" className="v-fb-chip" aria-pressed={tags.includes(k)} onClick={() => toggle(k)}>
                {label}
              </button>
            ))}
          </div>
          <label className="v-fb-comment">
            <span className="sr-only">Anything else? (optional)</span>
            <textarea rows={2} maxLength={COMMENT_MAX} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything else? (optional)" />
          </label>
          <div className="v-fb-actions">
            <button type="button" className="v-btn" onClick={() => setStep("ask")}>Change</button>
            <button type="button" className="v-btn v-btn-primary" disabled={busy} onClick={() => void send()}>
              {tags.length || comment.trim() ? "Send" : "Done"}
            </button>
          </div>
        </>
      )}
      {step === "thanks" && (
        <p className="v-fb-thanks" role="status">
          <span aria-hidden="true">{chosen?.emoji ?? "🙏"}</span> Thanks for the feedback!
        </p>
      )}
    </div>
  );
}
