"use client";

import "vidstack/player/styles/default/theme.css";
import "vidstack/player/styles/default/layouts/video.css";
import { MediaPlayer, MediaProvider, Track, type MediaPlayerInstance, type MediaProviderAdapter } from "@vidstack/react";
import { EpisodesIcon, SourcesIcon } from "./icons";
import { openWatchPanel } from "./watch-panel-events";
import { defaultLayoutIcons, DefaultVideoLayout } from "@vidstack/react/player/layouts/default";
import { isHLSProvider } from "vidstack";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import {
  pixeldrainId,
  pixeldrainInfoUrl,
  playbackCandidates,
  typeFromName,
  type PlayerType,
} from "@/lib/viewer/providers";
import type { WatchSource, WatchSubtitle } from "@/lib/viewer/watch";

export type ProgressTarget = { kind: "movie" | "episode"; id: string };
const SAVE_EVERY_MS = 15_000;

const isEnglish = (lang: string) => /^en(-|_|$)/i.test(lang.trim()) || lang.trim().toLowerCase() === "english";

export default function PlayerImpl({
  title,
  source,
  subtitles,
  track,
  startAt = 0,
}: {
  title: string;
  source: Pick<WatchSource, "kind" | "url">;
  subtitles: WatchSubtitle[];
  /** What to save progress against; omitted = no tracking. */
  track?: ProgressTarget;
  /** Resume position in seconds. */
  startAt?: number;
}) {
  const player = useRef<MediaPlayerInstance>(null);
  const lastSave = useRef(0);
  const seekTo = useRef(startAt);

  const save = useCallback(
    (unloading = false) => {
      const state = player.current?.state;
      if (!track || !state || !state.duration || state.currentTime <= 0) return;
      lastSave.current = Date.now();
      const init: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...track, position: state.currentTime, duration: state.duration }),
      };
      // keepalive lets the request outlive the page; a 401 retry is not possible there.
      if (unloading) fetch("/api/me/progress", { ...init, keepalive: true }).catch(() => {});
      else fetchWithRefresh("/api/me/progress", init).catch(() => {});
    },
    [track],
  );

  useEffect(() => {
    if (!track) return;
    const hide = () => document.visibilityState === "hidden" && save(true);
    document.addEventListener("visibilitychange", hide);
    const leave = () => save(true);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      save(true); // leaving the watch page (client navigation)
    };
  }, [track, save]);

  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hint, setHint] = useState<PlayerType | null>(null);
  const pdId = pixeldrainId(source.url);

  // Pixeldrain links carry no extension; ask its info API for the real file type (best effort).
  useEffect(() => {
    if (!pdId) return;
    const ctrl = new AbortController();
    fetch(pixeldrainInfoUrl(pdId), { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { name?: string; mime_type?: string } | null) => {
        const t = info?.name ? typeFromName(info.name) : null;
        if (t) setHint(t);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [pdId]);

  const candidates = playbackCandidates(source.kind, source.url, hint);
  const current = candidates[Math.min(attempt, candidates.length - 1)];
  const insecure = typeof window !== "undefined" && window.location.protocol === "https:" && source.url.startsWith("http:");
  const defaultSub = subtitles.find((s) => isEnglish(s.language))?.id;

  if (failed || insecure) {
    return (
      <div className="v-player-msg" role="alert">
        <strong>This source could not be played</strong>
        <p className="v-muted">
          {insecure
            ? "This source is not served over HTTPS, so the browser blocks it on this page."
            : "It may be offline or in a format your browser cannot play."}
        </p>
        <a href="#sources" className="v-btn v-btn-primary">Try another source</a>
      </div>
    );
  }

  return (
    <MediaPlayer
      ref={player}
      title={title}
      key={`${current.type}`}
      src={current}
      playsInline
      onProviderChange={(provider: MediaProviderAdapter | null) => {
        // Bundle hls.js ourselves (lazy chunk) instead of letting Vidstack fetch it from a CDN.
        if (isHLSProvider(provider)) provider.library = () => import("hls.js");
      }}
      onCanPlay={() => {
        const at = seekTo.current;
        seekTo.current = 0;
        const duration = player.current?.state.duration ?? 0;
        if (at > 0 && player.current && (!duration || at < duration - 5)) player.current.currentTime = at;
      }}
      onTimeUpdate={() => {
        if (Date.now() - lastSave.current >= SAVE_EVERY_MS) save();
      }}
      onPause={() => save()}
      onEnded={() => save()}
      onError={() => {
        if (attempt + 1 < candidates.length) setAttempt(attempt + 1);
        else setFailed(true);
      }}
    >
      <MediaProvider>
        {subtitles.map((s) => (
          <Track
            key={s.id}
            src={s.url}
            kind="subtitles"
            type={s.format}
            label={s.label}
            lang={s.language}
            default={s.id === defaultSub}
          />
        ))}
      </MediaProvider>
      <DefaultVideoLayout
        icons={defaultLayoutIcons}
        noScrubGesture={false}
        slots={{
          beforeCaptionButton: (
            <>
              {track?.kind === "episode" && (
                <button type="button" className="v-ctl" aria-label="Episodes" title="Episodes" onClick={() => openWatchPanel("episodes")}>
                  <EpisodesIcon size={26} />
                </button>
              )}
              <button type="button" className="v-ctl" aria-label="Sources" title="Sources" onClick={() => openWatchPanel("sources")}>
                <SourcesIcon size={26} />
              </button>
            </>
          ),
        }}
      />
    </MediaPlayer>
  );
}
