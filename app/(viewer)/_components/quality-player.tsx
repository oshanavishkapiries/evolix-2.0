"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import { normalizeSource } from "@/lib/viewer/providers";
import type { WatchSource, WatchSubtitle } from "@/lib/viewer/watch";
import type { PauseInfo, ProgressTarget } from "./player-impl";
import { PlayerStatus } from "./player-status";
import { SafePlayerBoundary } from "./safe-player-boundary";
import { WatchPlayer } from "./watch-player";

const OFFERED = ["1080p", "720p", "480p"];
const POLL_MS = 2500;
const MAX_POLLS = (45 * 60_000) / POLL_MS;

type Src = Pick<WatchSource, "id" | "kind" | "url"> & { quality: string };
type Prep = { quality: string; message: string; error?: string };
type Status = { status?: string; message?: string; result_url?: string; resolved_quality?: string; cache_failed?: boolean };

const rank = (q: string) => {
  const i = OFFERED.indexOf(q);
  return i < 0 ? OFFERED.length : i;
};

/**
 * Plays a cached file and lets the viewer switch quality from the player's settings menu. A quality the CDN does not
 * hold yet is prepared on demand (the engine fetches and caches it) behind a loading scene, then playback continues
 * from the same position.
 */
export function QualityPlayer({
  title,
  backHref,
  backdropPath,
  tmdbId,
  mediaType,
  season,
  episode,
  sources,
  selected,
  subtitles,
  track,
  startAt,
  info,
}: {
  title: string;
  backHref: string;
  backdropPath?: string | null;
  tmdbId: number;
  mediaType: "movie" | "tv";
  season?: number;
  episode?: number;
  sources: WatchSource[];
  selected: WatchSource & { quality: string };
  subtitles: WatchSubtitle[];
  track?: ProgressTarget;
  startAt?: number;
  info?: PauseInfo;
}) {
  const router = useRouter();
  const [quality, setQuality] = useState(selected.quality);
  const [at, setAt] = useState(startAt ?? 0);
  // Qualities prepared this session, usable before the refreshed page data lists them.
  const [fresh, setFresh] = useState<Record<string, Src>>({});
  const [prep, setPrep] = useState<Prep | null>(null);
  const run = useRef(0);
  useEffect(() => () => void run.current++, []);

  const cached = (q: string): Src | undefined => {
    const hit = sources.find((s) => s.quality === q && s.kind !== "embed");
    return hit ? { id: hit.id, kind: hit.kind, url: hit.url, quality: q } : fresh[q];
  };
  const active = cached(quality) ?? { id: selected.id, kind: selected.kind, url: selected.url, quality: selected.quality };
  const qualities = [...new Set([...OFFERED, ...sources.flatMap((s) => (s.quality ? [s.quality] : [])), ...Object.keys(fresh)])].sort((a, b) => rank(a) - rank(b));

  const prepare = useCallback(
    async (q: string) => {
      const token = ++run.current;
      const live = () => run.current === token;
      setPrep({ quality: q, message: "Starting…" });
      try {
        const res = await fetchWithRefresh("/api/evo/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbId, mediaType, quality: q, season, episode }),
        });
        const task = (await res.json()) as { task_id?: string; error?: string; message?: string };
        if (!res.ok || !task.task_id) throw new Error(task.error ?? task.message ?? "Could not start");

        for (let i = 0; i < MAX_POLLS && live(); i++) {
          const st = (await (await fetchWithRefresh(`/api/evo/status/${task.task_id}`, { cache: "no-store" })).json()) as Status;
          if (!live()) return;
          if (st.status === "COMPLETED" && st.result_url) {
            const got = st.resolved_quality ?? q;
            const file = normalizeSource({ id: `cdn-${got}`, kind: "direct" as const, url: st.result_url });
            setFresh((f) => ({ ...f, [got]: { ...file, quality: got } }));
            setQuality(got);
            setPrep(null);
            router.refresh(); // pulls the new source row into the page data
            return;
          }
          if (st.status === "FAILED" || st.cache_failed) throw new Error(st.message ?? "Could not prepare this quality");
          setPrep({ quality: q, message: st.message ?? "Working…" });
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
        if (live()) throw new Error("This is taking longer than expected. It keeps preparing in the background; try again in a few minutes.");
      } catch (e) {
        if (live()) setPrep({ quality: q, message: "", error: e instanceof Error ? e.message : "Something went wrong" });
      }
    },
    [tmdbId, mediaType, season, episode, router],
  );

  const select = (q: string, position: number) => {
    if (q === active.quality) return;
    setAt(position);
    if (cached(q)) setQuality(q);
    else void prepare(q);
  };
  const cancel = () => {
    run.current++;
    setPrep(null);
  };

  if (prep) {
    return prep.error ? (
      <PlayerStatus backdropPath={backdropPath} title={`Couldn’t prepare ${prep.quality}`} message={prep.error} error>
        <button type="button" className="v-btn v-btn-primary" onClick={() => void prepare(prep.quality)}>Try again</button>
        <button type="button" className="v-btn" onClick={cancel}>Keep watching {active.quality}</button>
      </PlayerStatus>
    ) : (
      <PlayerStatus
        backdropPath={backdropPath}
        kicker="Preparing"
        title={prep.quality}
        message={prep.message || "Working…"}
        note="First time at this quality, so it has to be fetched. Playback continues from where you were."
      >
        <button type="button" className="v-btn" onClick={cancel}>Keep watching {active.quality}</button>
      </PlayerStatus>
    );
  }

  return (
    <SafePlayerBoundary backHref={backHref}>
      <WatchPlayer
        playerKey={`q-${active.quality}`}
        title={title}
        source={{ id: active.id, kind: active.kind, url: active.url }}
        subtitles={subtitles}
        track={track}
        startAt={at}
        info={info}
        sinhala={{ tmdbId, mediaType, season, episode }}
        qualityMenu={{ current: active.quality, options: qualities.map((q) => ({ quality: q, cached: Boolean(cached(q)) })), onSelect: select }}
      />
    </SafePlayerBoundary>
  );
}
