"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { EvoProgressScreen } from "./evo-progress-screen";
import { EvoQualityPicker, type EvoQuality } from "./evo-quality-picker";
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
type PlayerStage = "SELECT_QUALITY" | "INGESTING" | "READY";

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
  const [selectedQuality, setSelectedQuality] = useState<EvoQuality>("1080p");
  const [stage, setStage] = useState<PlayerStage>(initialSource?.url ? "READY" : "SELECT_QUALITY");
  const [activeSource, setActiveSource] = useState<Pick<WatchSource, "id" | "kind" | "url"> | null>(
    initialSource ?? null
  );
  const [activeSubtitles, setActiveSubtitles] = useState<WatchSubtitle[]>(initialSubtitles || []);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskStatus>("PENDING");
  const [progressPct, setProgressPct] = useState(0);
  const [message, setMessage] = useState("Connecting to Evo Engine...");
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Trigger ingestion
  const startIngest = useCallback(
    async (qualityToUse?: EvoQuality) => {
      const targetQuality = qualityToUse ?? selectedQuality;
      setError(null);
      setStage("INGESTING");
      setStatus("PENDING");
      setProgressPct(0);
      setMessage(`Resolving stream (${targetQuality})...`);

      try {
        const res = await fetch("/api/evo/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tmdbId,
            mediaType,
            season,
            episode,
            quality: targetQuality,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({ error: "Failed to queue ingestion" }));
          throw new Error(errJson.error || `HTTP ${res.status}`);
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

        // 1. Instant Stream Ready (Zero wait!)
        if (data.stream_url) {
          const streamUrl = data.stream_url.replace(/^\/api\/v1\/media\/stream/, "/api/evo/stream");
          setActiveSource({
            id: `evo-stream-${tmdbId}-${season ?? 0}-${episode ?? 0}`,
            kind: "hls",
            url: streamUrl,
          });
          setStage("READY");
          return;
        }

        // 2. Persistent CDN File already available
        if (data.status === "COMPLETED" && data.result_url) {
          const ready = normalizeSource({
            id: `evo-cdn-${tmdbId}-${season ?? 0}-${episode ?? 0}`,
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
    [tmdbId, mediaType, season, episode, selectedQuality]
  );

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
            id: `evo-stream-${tmdbId}-${season ?? 0}-${episode ?? 0}`,
            kind: "hls",
            url: streamUrl,
          });
          setStage("READY");
          return;
        }

        // Cloud sync completed directly
        if (data.status === "COMPLETED" && data.result_url) {
          const ready = normalizeSource({
            id: `evo-cdn-${tmdbId}-${season ?? 0}-${episode ?? 0}`,
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
          setError(data.message || "Ingestion failed");
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
          setStage("SELECT_QUALITY");
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

  // 2. Quality selection stage
  if (stage === "SELECT_QUALITY") {
    return (
      <EvoQualityPicker
        title={title}
        backdropPath={backdropPath}
        selectedQuality={selectedQuality}
        onSelectQuality={setSelectedQuality}
        onConfirm={() => startIngest(selectedQuality)}
        backHref={backHref}
      />
    );
  }

  // 3. Ingestion progress stage
  return (
    <EvoProgressScreen
      title={title}
      backdropPath={backdropPath}
      status={status === "STREAMING" ? "COMPLETED" : status}
      progressPct={progressPct}
      message={message}
      error={error}
      onRetry={() => startIngest(selectedQuality)}
      backHref={backHref}
    />
  );
}
