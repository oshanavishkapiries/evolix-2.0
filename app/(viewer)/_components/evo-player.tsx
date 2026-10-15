"use client";

import { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import { EvoProgressScreen } from "./evo-progress-screen";
import type { PauseInfo, ProgressTarget } from "./player-impl";
import type { WatchSource, WatchSubtitle } from "@/lib/viewer/watch";

const PlayerImpl = dynamic(() => import("./player-impl"), {
  ssr: false,
  loading: () => (
    <div
      className="v-skel"
      style={{ position: "absolute", inset: 0, borderRadius: 0 }}
      aria-busy="true"
      aria-label="Loading player"
    />
  ),
});

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
  const [activeSource, setActiveSource] = useState<Pick<WatchSource, "id" | "kind" | "url"> | null>(
    initialSource ?? null
  );
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskStatus>("PENDING");
  const [progressPct, setProgressPct] = useState(0);
  const [message, setMessage] = useState("Connecting to Evo Engine...");
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // If a ready source already exists, play immediately
  if (activeSource?.url) {
    return (
      <PlayerImpl
        key={activeSource.id || activeSource.url}
        title={title}
        source={activeSource}
        subtitles={subtitles}
        track={track}
        startAt={startAt}
        info={info}
      />
    );
  }

  // Trigger ingestion
  const startIngest = async () => {
    setError(null);
    setStatus("PENDING");
    setProgressPct(0);
    setMessage("Submitting on-demand job...");

    try {
      const res = await fetch("/api/evo/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId, mediaType, quality: "1080p" }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: "Failed to queue ingestion" }));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setTaskId(data.task_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setError(msg);
      setStatus("FAILED");
    }
  };

  useEffect(() => {
    if (!activeSource) {
      startIngest();
    }
    return () => clearTimeout(pollTimer.current);
  }, [tmdbId]);

  // Poll status
  useEffect(() => {
    if (!taskId || activeSource) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/evo/status/${taskId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        setStatus(data.status);
        setProgressPct(data.progress_pct ?? 0);
        setMessage(data.message || "");

        if (data.status === "COMPLETED" && data.result_url) {
          // Transition directly to playback
          setActiveSource({
            id: `evo-${tmdbId}`,
            kind: "direct",
            url: data.result_url,
          });
          return;
        }

        if (data.status === "FAILED") {
          setError(data.message || "Ingestion failed");
          return;
        }

        pollTimer.current = setTimeout(poll, 1500);
      } catch (err: unknown) {
        pollTimer.current = setTimeout(poll, 3000);
      }
    };

    pollTimer.current = setTimeout(poll, 1000);

    return () => clearTimeout(pollTimer.current);
  }, [taskId, activeSource, tmdbId]);

  return (
    <EvoProgressScreen
      title={title}
      backdropPath={backdropPath}
      status={status}
      progressPct={progressPct}
      message={message}
      error={error}
      onRetry={startIngest}
      backHref={backHref}
    />
  );
}
