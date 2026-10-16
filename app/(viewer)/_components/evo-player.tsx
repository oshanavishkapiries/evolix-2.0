"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { imageUrl } from "@/lib/images";
import { WatchPlayer } from "./watch-player";
import { SafePlayerBoundary } from "./safe-player-boundary";
import type { PauseInfo, ProgressTarget } from "./player-impl";
import type { WatchSource, WatchSubtitle } from "@/lib/viewer/watch";
import { normalizeSource } from "@/lib/viewer/providers";

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
  return rawSubs.map((s) => {
    const item = s as Record<string, string>;
    const rawUrl = item.url || "";
    const cleanUrl = rawUrl.replace(/^\/api\/v1\/media\/subtitles/, "/api/evo/subtitles");
    return {
      id: item.id || `sub-${Math.random().toString(36).substring(2, 9)}`,
      label: item.label || "Subtitle",
      language: item.language || "en",
      format: (item.format === "srt" ? "srt" : "vtt") as "vtt" | "srt",
      url: cleanUrl,
    };
  });
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
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Trigger ingestion with 720p default
  const startIngest = useCallback(
    async (qualityToUse: string = "720p") => {
      setError(null);
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
          const errJson = await res.json().catch(() => ({ error: "Failed to queue stream" }));
          throw new Error(errJson.error || errJson.message || `HTTP ${res.status}`);
        }

        const data = await res.json();

        // Merge extracted subtitles if available
        if (data.subtitles && Array.isArray(data.subtitles)) {
          const parsed = formatSubtitles(data.subtitles);
          setActiveSubtitles((prev) => {
            const existingIds = new Set(prev.map((s) => s.id));
            return [...prev, ...parsed.filter((p) => !existingIds.has(p.id))];
          });
        }

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
        const msg = err instanceof Error ? err.message : "Connection failed";
        setError(msg);
        setStatus("FAILED");
      }
    },
    [tmdbId, mediaType, season, episode]
  );

  // Auto-start ingest on mount if no active source
  useEffect(() => {
    if (!activeSource && stage === "INGESTING" && !taskId) {
      startIngest("720p");
    }
  }, [activeSource, stage, taskId, startIngest]);

  // Poll status while ingesting
  useEffect(() => {
    if (!taskId || activeSource || stage !== "INGESTING") return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/evo/status/${taskId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
          setError(data.message || "Unable to load stream");
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
    return () => clearTimeout(pollTimer.current);
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
        />
      </SafePlayerBoundary>
    );
  }

  // 2. In-player loading dialogue stage
  const bg = backdropPath ? imageUrl(backdropPath, "w1280") : null;

  return (
    <div className="v-player-loading-overlay">
      {bg && <div className="v-player-loading-bg" style={{ backgroundImage: `url("${bg}")` }} />}
      <div className="v-player-loading-card">
        {!error ? (
          <>
            <div className="v-player-spinner" aria-hidden="true" />
            <h3 className="v-player-loading-title">{title}</h3>
            <p className="v-player-loading-status">{message || "Loading video stream..."}</p>
            {progressPct > 0 && progressPct < 100 && (
              <div className="v-player-loading-progress" aria-hidden="true">
                <div className="v-player-loading-fill" style={{ width: `${progressPct}%` }} />
              </div>
            )}
          </>
        ) : (
          <div className="v-player-loading-error">
            <h3 className="v-player-loading-title">Playback Error</h3>
            <p>{error}</p>
            <button
              type="button"
              className="v-btn v-btn-primary"
              onClick={() => startIngest("720p")}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
