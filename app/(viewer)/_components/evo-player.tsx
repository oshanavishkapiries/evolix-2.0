"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { PlayerStatus } from "./player-status";
import { WatchPlayer } from "./watch-player";
import { SafePlayerBoundary } from "./safe-player-boundary";
import type { PauseInfo, ProgressTarget } from "./player-impl";
import type { WatchSource, WatchSubtitle } from "@/lib/viewer/watch";
import { normalizeSource } from "@/lib/viewer/providers";
import { networkProblem, problemFromBody, problemOf, readProblem, type ViewerProblem } from "@/lib/client/problem";
import { busyDelay, MAX_BUSY_RETRIES } from "@/lib/evo/problems";
import { markBusyWaited } from "./feedback-moments";

type Props = {
  tmdbId: number;
  mediaType?: "movie" | "tv";
  season?: number;
  episode?: number;
  title: string;
  backdropPath?: string | null;
  backHref: string;
  initialSource?: Pick<WatchSource, "id" | "kind" | "url"> | null;
  subtitles: WatchSubtitle[];
  track?: ProgressTarget;
  startAt?: number;
  info?: PauseInfo;
};

type TaskStatus = "PENDING" | "EXTRACTING" | "STREAMING" | "DOWNLOADING" | "UPLOADING" | "COMPLETED" | "FAILED";
type PlayerStage = "INGESTING" | "READY";

function formatSubtitles(rawSubs: unknown[]): WatchSubtitle[] {
  if (!Array.isArray(rawSubs)) return [];
  return rawSubs.filter((s) => s && typeof s === "object").map((s) => {
    const item = s as Record<string, string>;
    const rawUrl = item.url || "";
    const cleanUrl = rawUrl.replace(/^\/api\/v1\/media\/subtitles/, "/api/evo/subtitles");
    return {
      id: item.id || `sub-${Math.random().toString(36).substring(2, 9)}`,
      label: item.label || "Subtitle",
      language: item.language || "en",
      format: (item.format === "srt" ? "srt" : "vtt") as "vtt" | "srt",
      url: cleanUrl,
      source: "auto" as const,
    };
  }).filter((s) => !s.url.startsWith("/api/evo/subtitles/") || /^sub_\d+_[a-z]{2,3}_\d+$/.test(s.id));
}

export function EvoPlayer({
  tmdbId,
  mediaType = "movie",
  season,
  episode,
  title,
  backdropPath,
  backHref,
  initialSource,
  subtitles: initialSubtitles,
  track,
  startAt,
  info,
}: Props) {
  const [stage, setStage] = useState<PlayerStage>(initialSource?.url ? "READY" : "INGESTING");
  const [activeSource, setActiveSource] = useState<Pick<WatchSource, "id" | "kind" | "url"> | null>(
    initialSource ?? null
  );
  const [activeSubtitles, setActiveSubtitles] = useState<WatchSubtitle[]>(initialSubtitles || []);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [, setStatus] = useState<TaskStatus>("PENDING");
  const [progressPct, setProgressPct] = useState(0);
  const [message, setMessage] = useState("Loading stream (720p)...");
  const [problem, setProblem] = useState<ViewerProblem | null>(null);
  /** Seconds until the next automatic try while the servers are busy (null when not waiting). */
  const [retryIn, setRetryIn] = useState<number | null>(null);
  const busyTries = useRef(0);
  const [busyTry, setBusyTry] = useState(0); // the same count, for the screen
  const countdown = useRef<ReturnType<typeof setInterval>>(undefined);
  const startAgain = useRef<(quality: string, automatic: boolean) => void>(() => {});
  const pollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const stopCountdown = useCallback(() => {
    clearInterval(countdown.current);
    setRetryIn(null);
  }, []);
  const waitThenRetry = useCallback((seconds: number, quality: string) => {
    clearInterval(countdown.current);
    let left = seconds;
    setRetryIn(left);
    countdown.current = setInterval(() => {
      left -= 1;
      if (left > 0) return setRetryIn(left);
      clearInterval(countdown.current);
      setRetryIn(null);
      startAgain.current(quality, true);
    }, 1000);
  }, []);

  // Trigger ingestion with 720p default
  const startIngest = useCallback(
    async (qualityToUse: string = "720p", automatic = false) => {
      stopCountdown();
      // A viewer pressing the button starts a fresh set of busy retries; our own retries use up the same set.
      if (!automatic) {
        busyTries.current = 0;
        setBusyTry(0);
      }
      setProblem(null);
      setStage("INGESTING");
      setStatus("PENDING");
      setProgressPct(0);
      setMessage(`Connecting stream (${qualityToUse})...`);

      try {
        const res = await fetch("/api/evo/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tmdbId,
            mediaType,
            season,
            episode,
            quality: qualityToUse,
          }),
        });

        if (!res.ok) {
          const failure = await readProblem(res);
          if (failure.code === "BUSY") {
            if (busyTries.current < MAX_BUSY_RETRIES) {
              // Busy is not an error: stay on a calm waiting scene and come back by ourselves, a little later each time.
              setProblem(failure);
              waitThenRetry(busyDelay(failure.retryAfter, busyTries.current), qualityToUse);
              busyTries.current += 1;
              setBusyTry(busyTries.current);
              return;
            }
            failure.message = "It’s still very busy. Please try again in a few minutes.";
          }
          setProblem(failure);
          setStatus("FAILED");
          return;
        }

        // The player asks "Was the wait OK?" (if that question is on) once this viewer got through a busy wait.
        if (busyTries.current > 0) markBusyWaited();
        busyTries.current = 0;
        const data = await res.json();

        // Merge extracted subtitles if available
        if (data.subtitles && Array.isArray(data.subtitles)) {
          const parsed = formatSubtitles(data.subtitles);
          setActiveSubtitles((prev) => {
            const existingIds = new Set(prev.map((s) => s.id));
            return [...prev, ...parsed.filter((p) => !existingIds.has(p.id))];
          });
        }

        setTaskId(data.task_id);

        // 1. Instant Stream Ready (Zero wait!), unless the CDN copy already exists (checked next)
        if (data.stream_url && !(data.status === "COMPLETED" && data.result_url)) {
          const streamUrl = data.stream_url.replace(/^\/api\/v1\/media\/stream/, "/api/evo/stream");
          setActiveSource({
            id: `stream-${tmdbId}-${season ?? 0}-${episode ?? 0}`,
            kind: "hls",
            url: streamUrl,
          });
          setStage("READY");
          return;
        }

        // 2. Persistent CDN File already available
        if (data.status === "COMPLETED" && data.result_url) {
          const ready = normalizeSource({
            id: `cdn-${tmdbId}-${season ?? 0}-${episode ?? 0}`,
            kind: "direct",
            url: data.result_url,
          });
          setActiveSource({
            id: ready.id,
            kind: ready.kind,
            url: ready.url,
          });
          setStage("READY");
          return;
        }

        setTaskId(data.task_id);
        setStatus(data.status ?? "PENDING");
      } catch (err: unknown) {
        // fetch itself failing (a TypeError) means the request never got out; anything else is a bug on our side.
        setProblem(err instanceof TypeError ? networkProblem() : problemOf("UNKNOWN"));
        setStatus("FAILED");
      }
    },
    [tmdbId, mediaType, season, episode, stopCountdown, waitThenRetry]
  );
  useEffect(() => {
    startAgain.current = startIngest;
  }, [startIngest]);

  // Offline: carry on by ourselves the moment the connection is back.
  useEffect(() => {
    if (problem?.code !== "OFFLINE") return;
    const back = () => startIngest("720p");
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [problem, startIngest]);

  // Auto-start ingest on mount if no active source
  useEffect(() => {
    if (activeSource || stage !== "INGESTING" || taskId) return;
    const t = setTimeout(() => startIngest("720p"), 0); // deferred: startIngest sets state
    return () => clearTimeout(t);
  }, [activeSource, stage, taskId, startIngest]);

  // Poll status while ingesting
  useEffect(() => {
    if (!taskId || activeSource || stage !== "INGESTING") return;

    let misses = 0;
    const poll = async () => {
      try {
        const res = await fetch(`/api/evo/status/${taskId}`, { cache: "no-store" });
        if (!res.ok) {
          const failure = await readProblem(res);
          // The engine that owns this task is down or no longer knows it: stop waiting and offer the normal retry
          // (which picks a healthy engine). Anything else may pass, so it is tried again a few times first.
          if (failure.code === "ENGINE_UNAVAILABLE" || failure.code === "NO_SOURCE" || ++misses >= 6) {
            setProblem(failure);
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        misses = 0;

        const data = await res.json();
        setStatus(data.status);
        setProgressPct(data.progress_pct ?? 0);
        setMessage(data.message || "");

        // Merge subtitles when they arrive
        if (data.subtitles && Array.isArray(data.subtitles)) {
          const parsed = formatSubtitles(data.subtitles);
          setActiveSubtitles((prev) => {
            const existingIds = new Set(prev.map((s) => s.id));
            return [...prev, ...parsed.filter((p) => !existingIds.has(p.id))];
          });
        }

        // Instant Stream Ready via HLS proxy
        if (data.status === "STREAMING" && data.stream_url) {
          const streamUrl = data.stream_url.replace(/^\/api\/v1\/media\/stream/, "/api/evo/stream");
          setActiveSource({
            id: `stream-${tmdbId}-${season ?? 0}-${episode ?? 0}`,
            kind: "hls",
            url: streamUrl,
          });
          setStage("READY");
          return;
        }

        // Cloud sync completed directly
        if (data.status === "COMPLETED" && data.result_url) {
          const ready = normalizeSource({
            id: `cdn-${tmdbId}-${season ?? 0}-${episode ?? 0}`,
            kind: "direct",
            url: data.result_url,
          });
          setActiveSource({
            id: ready.id,
            kind: ready.kind,
            url: ready.url,
          });
          setStage("READY");
          return;
        }

        if (data.status === "FAILED") {
          setProblem(problemFromBody(data));
          return;
        }

        pollTimer.current = setTimeout(poll, 1200);
      } catch {
        pollTimer.current = setTimeout(poll, 2500);
      }
    };

    pollTimer.current = setTimeout(poll, 800);

    return () => clearTimeout(pollTimer.current);
  }, [taskId, activeSource, tmdbId, season, episode, stage]);

  // Clean up poll timer on unmount
  useEffect(() => {
    return () => {
      clearTimeout(pollTimer.current);
      clearInterval(countdown.current);
    };
  }, []);

  // 1. Playback stage
  if (stage === "READY" && activeSource?.url) {
    return (
      <SafePlayerBoundary
        backHref={backHref}
        onReset={() => {
          setActiveSource(null);
          setTaskId(null);
          setStage("INGESTING");
          startIngest("720p");
        }}
      >
        <WatchPlayer
          title={title}
          source={activeSource}
          subtitles={activeSubtitles}
          track={track}
          startAt={startAt}
          info={info}
          sinhala={{ tmdbId, mediaType, season, episode }}
        />
      </SafePlayerBoundary>
    );
  }

  // 2. Connecting to the stream
  const waiting = problem?.code === "BUSY" && retryIn !== null;
  return (
    <PlayerStatus
      backdropPath={backdropPath}
      kicker={waiting ? "Busy" : problem ? undefined : "On demand"}
      title={problem ? problem.title : title}
      message={waiting ? `${problem.message} Trying again in ${retryIn}s…` : problem ? problem.message : (message || "Connecting to the stream…")}
      note={waiting ? `Retry ${busyTry} of ${MAX_BUSY_RETRIES}` : problem?.ref ? `Reference: ${problem.ref}` : undefined}
      progress={problem ? undefined : progressPct}
      error={Boolean(problem) && !waiting && problem?.code !== "NOT_AIRED"}
      idle={problem?.code === "NOT_AIRED"}
    >
      {problem && (
        <>
          {problem.code !== "NOT_AIRED" && <button type="button" className="v-btn v-btn-primary" onClick={() => startIngest("720p")}>{waiting ? "Try now" : "Try again"}</button>}
          <Link href={backHref} className="v-btn">Back</Link>
        </>
      )}
    </PlayerStatus>
  );
}
