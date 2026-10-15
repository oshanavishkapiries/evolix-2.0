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
  title: string;
  backdropPath?: string | null;
  backHref: string;
  initialSource?: Pick<WatchSource, "id" | "kind" | "url"> | null;
  subtitles: WatchSubtitle[];
  track?: ProgressTarget;
  startAt?: number;
  info?: PauseInfo;
};

type TaskStatus = "PENDING" | "EXTRACTING" | "DOWNLOADING" | "UPLOADING" | "COMPLETED" | "FAILED";
type PlayerStage = "SELECT_QUALITY" | "INGESTING" | "READY";

export function EvoPlayer({
  tmdbId,
  mediaType = "movie",
  title,
  backdropPath,
  backHref,
  initialSource,
  subtitles,
  track,
  startAt,
  info,
}: Props) {
  const [selectedQuality, setSelectedQuality] = useState<EvoQuality>("1080p");
  const [stage, setStage] = useState<PlayerStage>(initialSource?.url ? "READY" : "SELECT_QUALITY");
  const [activeSource, setActiveSource] = useState<Pick<WatchSource, "id" | "kind" | "url"> | null>(
    initialSource ?? null
  );
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
      setMessage(`Submitting on-demand job (${targetQuality})...`);

      try {
        const res = await fetch("/api/evo/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbId, mediaType, quality: targetQuality }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({ error: "Failed to queue ingestion" }));
          throw new Error(errJson.error || `HTTP ${res.status}`);
        }

        const data = await res.json();

        // If server already has a completed result, jump straight to playback
        if (data.status === "COMPLETED" && data.result_url) {
          const ready = normalizeSource({ id: `evo-${tmdbId}`, kind: "direct", url: data.result_url });
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
    [tmdbId, mediaType, selectedQuality]
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

        if (data.status === "COMPLETED" && data.result_url) {
          const ready = normalizeSource({ id: `evo-${tmdbId}`, kind: "direct", url: data.result_url });
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

        pollTimer.current = setTimeout(poll, 1500);
      } catch {
        pollTimer.current = setTimeout(poll, 3000);
      }
    };

    pollTimer.current = setTimeout(poll, 1000);

    return () => clearTimeout(pollTimer.current);
  }, [taskId, activeSource, tmdbId, stage]);

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
          subtitles={subtitles}
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
      status={status}
      progressPct={progressPct}
      message={message}
      error={error}
      onRetry={() => startIngest(selectedQuality)}
      backHref={backHref}
    />
  );
}
