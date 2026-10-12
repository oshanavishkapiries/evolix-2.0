"use client";

import "vidstack/player/styles/default/theme.css";
import "vidstack/player/styles/default/layouts/video.css";
import { MediaPlayer, MediaProvider, Track, type MediaPlayerInstance, type MediaProviderAdapter } from "@vidstack/react";
import { defaultLayoutIcons, DefaultVideoLayout } from "@vidstack/react/player/layouts/default";
import { isHLSProvider } from "vidstack";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import { imageUrl } from "@/lib/images";
import {
  pixeldrainId,
  pixeldrainInfoUrl,
  playbackCandidates,
  typeFromName,
  type PlayerType,
} from "@/lib/viewer/providers";
import type { WatchSource, WatchSubtitle } from "@/lib/viewer/watch";
import { loadStyle, saveStyle, styleVars, type SubStyle } from "./subtitle-style";
import { SubtitleButton, SubtitleTools, type SubTab } from "./subtitle-tools";

export type ProgressTarget = { kind: "movie" | "episode"; id: string };
/** Shown over the video while paused, Netflix-style. */
export type PauseInfo = { title: string; meta?: string; overview?: string; backdropPath?: string | null };
const SAVE_EVERY_MS = 15_000;
const PAUSE_OVERLAY_DELAY_MS = 1500;

const isEnglish = (lang: string) => /^en(-|_|$)/i.test(lang.trim()) || lang.trim().toLowerCase() === "english";

export default function PlayerImpl({
  title,
  source,
  subtitles,
  track,
  startAt = 0,
  info,
}: {
  title: string;
  source: Pick<WatchSource, "kind" | "url">;
  subtitles: WatchSubtitle[];
  /** What to save progress against; omitted = no tracking. */
  track?: ProgressTarget;
  /** Resume position in seconds. */
  startAt?: number;
  info?: PauseInfo;
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

  const [paused, setPaused] = useState(false);
  const pauseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pauseTimer.current), []);
  const resumed = () => {
    clearTimeout(pauseTimer.current);
    setPaused(false);
  };

  const [subOpen, setSubOpen] = useState(false);
  const [subTab, setSubTab] = useState<SubTab>("style");
  // Client-only component (dynamic, ssr: false), so localStorage is safe to read here.
  const [subStyle, setSubStyle] = useState<SubStyle>(loadStyle);
  const changeSubStyle = (s: SubStyle) => {
    setSubStyle(s);
    saveStyle(s);
  };
  const closeSubPanel = useCallback(() => setSubOpen(false), []);

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
      style={styleVars(subStyle)}
      playsInline
      autoPlay
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
      onPlay={resumed}
      onSeeking={resumed}
      onPause={() => {
        save();
        const s = player.current?.state;
        if (s?.ended || s?.seeking) return;
        clearTimeout(pauseTimer.current);
        pauseTimer.current = setTimeout(() => setPaused(true), PAUSE_OVERLAY_DELAY_MS);
      }}
      onEnded={() => {
        resumed();
        save();
      }}
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
            id={s.id}
            default={s.id === defaultSub}
          />
        ))}
      </MediaProvider>
      {info && paused && !subOpen && <PauseOverlay info={info} />}
      <DefaultVideoLayout
        icons={defaultLayoutIcons}
        noScrubGesture={false}
        slots={
          subtitles.length > 0
            ? { afterCaptionButton: <SubtitleButton open={subOpen} onToggle={() => setSubOpen((o) => !o)} /> }
            : undefined
        }
      />
      {subtitles.length > 0 && (
        <SubtitleTools
          open={subOpen}
          tab={subTab}
          onTab={setSubTab}
          onClose={closeSubPanel}
          style={subStyle}
          onStyle={changeSubStyle}
        />
      )}
    </MediaPlayer>
  );
}

function PauseOverlay({ info }: { info: PauseInfo }) {
  const bg = imageUrl(info.backdropPath, "w1280");
  return (
    <div className="v-pause" aria-hidden="true">
      {bg && (
        // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
        <img className="v-pause-bg" src={bg} alt="" decoding="async" />
      )}
      <div className="v-pause-info">
        <p className="v-pause-kicker">You are watching</p>
        <h2>{info.title}</h2>
        {info.meta && <p className="v-pause-meta">{info.meta}</p>}
        {info.overview && <p className="v-pause-overview">{info.overview}</p>}
      </div>
    </div>
  );
}
