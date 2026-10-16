"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaPlayerInstance, TextTrack } from "@vidstack/react";
import { fetchWithRefresh } from "@/lib/client/api";
import type { SinhalaState } from "@/lib/evo/sinhala";
import type { WatchSubtitle } from "@/lib/viewer/watch";
import { PlayerBanner } from "./player-banner";

/** The title the Sinhala subtitles belong to; the server needs nothing else (no engine task id). */
export type SinhalaTarget = { tmdbId: number; mediaType: "movie" | "tv"; season?: number; episode?: number };

/** Id of the "Sinhala (AI)" entry shown before a track exists; picking it starts the translation. */
export const PENDING_ID = "si-ai-pending";
export const pendingTrack: WatchSubtitle = { id: PENDING_ID, label: "Sinhala (AI)", language: "si", format: "vtt", url: "" };

const POLL_MS = 3000;
const GIVE_UP_MS = 15 * 60_000;
const MISSES = 4;
const DONE_NOTE_MS = 5000;

// Module level so a player remount (quality switch) neither forgets a finished track nor abandons a running job.
const finished = new Map<string, WatchSubtitle>();
const inFlight = new Set<string>();

const keyOf = (t: SinhalaTarget) => `${t.mediaType}:${t.tmdbId}:${t.season ?? 0}:${t.episode ?? 0}`;
const isSi = (lang: string) => /^si(n)?(-|_|$)/i.test(lang.trim()) || lang.trim().toLowerCase() === "sinhala";
const isEn = (lang: string) => /^en(-|_|$)/i.test(lang.trim()) || lang.trim().toLowerCase() === "english";

type Tracks = MediaPlayerInstance["textTracks"];

/** Turns one text track on (and the others off), or just sets one track's mode. Returns false when it is not there yet. */
function showOnly(list: Tracks | undefined, id: string): boolean {
  const t = list && [...list].find((x) => x.id === id);
  if (!list || !t) return false;
  for (const other of list) if (other !== t && other.mode === "showing") other.mode = "disabled";
  t.mode = "showing";
  return true;
}
function setMode(list: Tracks | undefined, id: string, mode: "showing" | "disabled") {
  const t = list && [...list].find((x) => x.id === id);
  if (t) t.mode = mode;
}

type Phase = "idle" | "running" | "done" | "failed" | "unavailable";

/**
 * Sinhala subtitles on demand. The menu always offers "Sinhala (AI)" when the title has an English subtitle to
 * translate; if no Sinhala track exists yet, picking it starts the translation in the background while the video and
 * the English subtitles carry on. When the track is ready it is loaded and selected.
 */
export function useSinhalaSubtitles({ target, subtitles, player }: { target?: SinhalaTarget; subtitles: WatchSubtitle[]; player: React.RefObject<MediaPlayerInstance | null> }) {
  const key = target ? keyOf(target) : "";
  const [phase, setPhase] = useState<Phase>(() => (key && finished.has(key) ? "done" : key && inFlight.has(key) ? "running" : "idle"));
  const [found, setFound] = useState<WatchSubtitle | null>(() => (key ? (finished.get(key) ?? null) : null));
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [doneNote, setDoneNote] = useState(false);
  const run = useRef(0);
  const lastReal = useRef<string | null>(null);
  /** Invalidates any running poll loop (each loop holds the token it started with). */
  const cancel = useCallback(() => {
    run.current++;
  }, []);

  const hasSinhala = Boolean(found) || subtitles.some((s) => isSi(s.language));
  const hasEnglish = subtitles.some((s) => isEn(s.language));
  const offered = Boolean(target) && !hasSinhala && hasEnglish;
  /** Why the option is missing, for the subtitle panel. */
  const unavailableNote = target && !hasSinhala && !hasEnglish ? "Sinhala (AI) needs an English subtitle to translate from, and this title has none." : null;

  const apply = useCallback(
    (s: SinhalaState | null, k: string): boolean => {
      if (!s) return false;
      if (s.state === "done" && s.subtitle) {
        finished.set(k, s.subtitle);
        inFlight.delete(k);
        setFound(s.subtitle);
        setPhase("done");
        setDoneNote(true);
        return true;
      }
      if (s.state === "running") {
        setPhase("running");
        setProgress(s.progress ?? null);
        return false;
      }
      inFlight.delete(k);
      setMessage(s.message ?? "");
      setPhase(s.state === "unavailable" ? "unavailable" : "failed");
      return true;
    },
    [],
  );

  /** Polls until the job finishes, fails, takes too long, or the player goes away. */
  const watch = useCallback(
    async (t: SinhalaTarget, token: number) => {
      const k = keyOf(t);
      const started = Date.now();
      const q = new URLSearchParams({ tmdbId: String(t.tmdbId), mediaType: t.mediaType, ...(t.season !== undefined ? { season: String(t.season) } : {}), ...(t.episode !== undefined ? { episode: String(t.episode) } : {}) });
      let misses = 0;
      while (run.current === token) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (run.current !== token) return;
        let state: SinhalaState | null = null;
        try {
          const res = await fetchWithRefresh(`/api/evo/translate?${q}`, { cache: "no-store" });
          state = res.ok ? ((await res.json()) as SinhalaState) : null;
        } catch {
          state = null;
        }
        if (run.current !== token) return;
        // A lost answer, or a job the engine no longer knows, is retried a few times before giving up.
        if (!state || state.state === "none") {
          if (++misses >= MISSES) return void apply({ state: "failed", message: "Lost track of the translation. Try again." }, k);
          continue;
        }
        misses = 0;
        if (apply(state, k)) return;
        if (Date.now() - started > GIVE_UP_MS) return void apply({ state: "failed", message: "This is taking longer than expected. Try again in a few minutes." }, k);
      }
    },
    [apply],
  );

  const start = useCallback(async () => {
    if (!target) return;
    const k = keyOf(target);
    const token = ++run.current;
    inFlight.add(k);
    setHidden(false);
    setMessage("");
    setProgress(null);
    setPhase("running");
    let state: SinhalaState | null = null;
    try {
      const res = await fetchWithRefresh("/api/evo/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      const body = (await res.json().catch(() => null)) as (SinhalaState & { error?: string; message?: string }) | null;
      state = res.ok ? body : { state: "failed", message: res.status === 429 ? "Too many requests, try again in a few minutes." : "Could not reach the subtitle service." };
    } catch {
      state = { state: "failed", message: "Could not reach the subtitle service." };
    }
    if (run.current !== token) return;
    if (!apply(state, k)) void watch(target, token);
  }, [target, apply, watch]);

  // A job left running by a previous mount of this player (quality switch) is picked up again.
  useEffect(() => {
    if (!target || !inFlight.has(key) || finished.has(key)) return;
    const token = ++run.current;
    void watch(target, token);
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume once per title
  }, [key]);
  useEffect(() => cancel, [cancel]);

  // Back to the real subtitle while the translation runs: the placeholder carries no cues.
  const onTrackChange = useCallback(
    (track: TextTrack | null) => {
      if (!track) return;
      const list = player.current?.textTracks;
      if (track.id !== (PENDING_ID as string)) {
        lastReal.current = track.id;
        return;
      }
      if (phase !== "running") void start();
      else setHidden(false);
      setMode(list, PENDING_ID, "disabled");
      if (lastReal.current) setMode(list, lastReal.current, "showing");
    },
    [phase, start, player],
  );

  // Select the new track as soon as the player has it.
  useEffect(() => {
    if (!found) return;
    const list = player.current?.textTracks;
    if (!list) return;
    const pick = () => showOnly(list, found.id);
    if (pick()) return;
    const on = () => {
      if (pick()) list.removeEventListener("add", on);
    };
    list.addEventListener("add", on);
    return () => list.removeEventListener("add", on);
  }, [found, player]);

  useEffect(() => {
    if (!doneNote) return;
    const t = setTimeout(() => setDoneNote(false), DONE_NOTE_MS);
    return () => clearTimeout(t);
  }, [doneNote]);

  /** Tracks to render: the page's, the one just made, and the placeholder while none exists. */
  const tracks = [...subtitles.filter((s) => !(found && isSi(s.language))), ...(found ? [found] : []), ...(offered && phase !== "done" ? [pendingTrack] : [])];

  let banner: React.ReactNode = null;
  if (!hidden && target) {
    if (phase === "running")
      banner = (
        <PlayerBanner
          place="start"
          title="Preparing Sinhala subtitles…"
          text={(progress ? `Part ${progress.done} of ${progress.total}. ` : "") + "You can keep watching, English subtitles stay on."}
          onClose={() => setHidden(true)}
        />
      );
    else if (phase === "failed" || phase === "unavailable")
      banner = (
        <PlayerBanner
          place="start"
          title={phase === "unavailable" ? "Sinhala subtitles are unavailable right now" : "Couldn’t prepare Sinhala subtitles"}
          text={message || (phase === "unavailable" ? "Try again later. English subtitles keep working." : "English subtitles keep working.")}
          action="Retry"
          onAction={() => void start()}
          onClose={() => setHidden(true)}
        />
      );
    else if (phase === "done" && doneNote) banner = <PlayerBanner place="start" title="Sinhala subtitles are ready" text="Switched to Sinhala (AI)." onClose={() => setDoneNote(false)} />;
  }

  return { tracks, banner, onTrackChange, unavailableNote };
}
