"use client";

import "vidstack/player/styles/default/theme.css";
import "vidstack/player/styles/default/layouts/video.css";
import { MediaPlayer, MediaProvider, Menu, Track, useMediaState, type MediaPlayerInstance, type MediaProviderAdapter } from "@vidstack/react";
import { defaultLayoutIcons, DefaultMenuButton, DefaultMenuRadioGroup, DefaultVideoLayout } from "@vidstack/react/player/layouts/default";
import { isHLSProvider } from "vidstack";
import { useRouter } from "next/navigation";
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
import { PlayerBanner, useQualityAdvisor } from "./player-banner";
import { SubtitleButton, SubtitleTools, type SubTab } from "./subtitle-tools";

export type ProgressTarget = { kind: "movie" | "episode"; id: string };
/** Shown over the video while paused, Netflix-style. */
export type PauseInfo = { title: string; meta?: string; overview?: string; backdropPath?: string | null };
/**
 * Quality switcher for cached (single-file) sources: every offered quality is listed, uncached ones are marked
 * and get prepared on demand by the parent. HLS streams keep Vidstack's own quality menu instead.
 */
export type QualityMenu = {
  current: string;
  options: { quality: string; cached: boolean }[];
  /** `at` is the playback position to continue from. */
  onSelect: (quality: string, at: number) => void;
};
const SAVE_EVERY_MS = 15_000;
/** Streams start (and stay) here unless the viewer picks otherwise. */
const DEFAULT_HEIGHT = 720;
const START_NOTE_MS = 6000;
const PAUSE_OVERLAY_DELAY_MS = 1500;

const isSinhala = (lang: string) => /^si(n)?(-|_|$)/i.test(lang.trim()) || lang.trim().toLowerCase() === "sinhala";
const isEnglish = (lang: string) => /^en(-|_|$)/i.test(lang.trim()) || lang.trim().toLowerCase() === "english";

export default function PlayerImpl({
  title,
  source,
  subtitles = [],
  track,
  startAt = 0,
  info,
  qualityMenu,
}: {
  title: string;
  source: Pick<WatchSource, "kind" | "url"> & { id?: string };
  subtitles: WatchSubtitle[];
  /** What to save progress against; omitted = no tracking. */
  track?: ProgressTarget;
  /** Resume position in seconds. */
  startAt?: number;
  info?: PauseInfo;
  qualityMenu?: QualityMenu;
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

  // A CDN copy that no longer exists is deactivated server-side (it checks with the CDN); the refresh then
  // lands on another quality or a fresh Evo ingest. Other failures (codec, network) are left to the viewer.
  const router = useRouter();
  const [healChecked, setHealChecked] = useState(false);
  const healable = Boolean(pdId && source.id && /^[0-9a-f-]{36}$/i.test(source.id));
  useEffect(() => {
    if (!failed || !healable) return;
    fetchWithRefresh("/api/evo/heal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: source.id }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { healed?: boolean } | null) => {
        if (d?.healed) router.refresh();
        else setHealChecked(true);
      })
      .catch(() => setHealChecked(true));
  }, [failed, healable, source.id, router]);

  // Pixeldrain links carry no extension; ask its info API for the real file type (best effort).
  useEffect(() => {
    if (!pdId) return;
    const ctrl = new AbortController();
    fetch(pixeldrainInfoUrl(pdId), { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { name?: string; mime_type?: string; size?: number } | null) => {
        const t = info?.name ? typeFromName(info.name) : null;
        if (t) setHint(t);
        if (info?.size) fileBytes.current = info.size;
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [pdId]);

  const candidates = playbackCandidates(source.kind, source.url, hint);
  const current = candidates[Math.min(attempt, candidates.length - 1)];
  const insecure = typeof window !== "undefined" && window.location.protocol === "https:" && source.url.startsWith("http:");
  const defaultSub = ((subtitles ?? []).find((s) => isSinhala(s.language)) ?? (subtitles ?? []).find((s) => isEnglish(s.language)))?.id;

  // ---- quality: never switched behind the viewer's back. HLS starts on 720p and stays there (no adaptive
  // switching, no "switching" toast); a better-fitting quality is only ever suggested (see the advisor below).
  const qualityLocked = useRef(false);
  const lockDefaultQuality = () => {
    const hls = hlsOf()?.instance as { levels: { height?: number }[]; currentLevel: number } | null | undefined;
    if (!hls || qualityLocked.current || hls.levels.length < 2) return;
    const heights: number[] = hls.levels.map((l) => l.height || 0);
    const below = heights.flatMap((h, i) => (h && h < DEFAULT_HEIGHT ? [[h, i]] : [])).sort((x, y) => y[0] - x[0])[0];
    const index = heights.indexOf(DEFAULT_HEIGHT) >= 0 ? heights.indexOf(DEFAULT_HEIGHT) : below ? below[1] : heights.indexOf(Math.min(...heights.filter(Boolean)));
    if (index < 0) return;
    qualityLocked.current = true;
    // A fixed level turns adaptive switching off. It goes through Vidstack's own quality list (so its menu shows the
    // real selection instead of "Auto") but after Vidstack has finished handling the levels event: changing the list
    // from inside that event can break the menu's render.
    const height = heights[index];
    setTimeout(() => {
      try {
        const item = [...(player.current?.qualities ?? [])].find((q) => q.height === height);
        if (item) item.selected = true;
        else hls.currentLevel = index;
      } catch {
        // player was torn down in between
      }
    }, 0);
  };
  const hlsOf = () => {
    const provider = player.current?.provider;
    return isHLSProvider(provider) ? provider : null;
  };
  const nowQuality = (): string | null => {
    if (qualityMenu) return qualityMenu.current;
    const h = player.current?.state.quality?.height;
    return h ? `${h}p` : null;
  };
  const offeredQualities = (): string[] =>
    qualityMenu ? qualityMenu.options.map((o) => o.quality) : [...(player.current?.qualities ?? [])].flatMap((q) => (q.height ? [`${q.height}p`] : []));
  const switchTo = (quality: string) => {
    if (qualityMenu) return qualityMenu.onSelect(quality, player.current?.state.currentTime ?? 0);
    const level = [...(player.current?.qualities ?? [])].find((q) => `${q.height}p` === quality);
    if (level) level.selected = true;
  };
  // Throughput for the advisor: hls.js measures it for streams; for a single file it is derived from how fast the
  // buffer fills (seconds of video per second) times the file's bitrate. Null when there is nothing to measure.
  const fileBytes = useRef(0);
  const lastBuffer = useRef<{ at: number; end: number } | null>(null);
  const readMbps = (): number | null => {
    const hls = hlsOf()?.instance;
    if (hls) return hls.bandwidthEstimate > 0 ? hls.bandwidthEstimate / 1e6 : null;
    const st = player.current?.state;
    if (!st || !st.duration || !fileBytes.current || st.seeking) return null;
    const prev = lastBuffer.current;
    lastBuffer.current = { at: performance.now(), end: st.bufferedEnd };
    if (!prev) return null;
    const grew = st.bufferedEnd - prev.end;
    const secs = (performance.now() - prev.at) / 1000;
    return grew > 0.05 && secs > 0 ? (grew / secs) * ((fileBytes.current * 8) / st.duration / 1e6) : null;
  };
  const [started, setStarted] = useState(false);
  const [startNote, setStartNote] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(noteTimer.current), []);
  const advisor = useQualityAdvisor({ active: started, current: nowQuality, offered: offeredQualities, readMbps, onSwitch: switchTo });

  if (failed && healable && !healChecked) {
    return (
      <div className="v-player-msg" role="status">
        <strong>Finding a fresh copy…</strong>
        <p className="v-muted">This copy stopped responding, checking it now.</p>
      </div>
    );
  }

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
      onQualitiesChange={lockDefaultQuality}
      onPlaying={() => {
        if (started) return;
        setStarted(true);
        setStartNote(true);
        clearTimeout(noteTimer.current);
        noteTimer.current = setTimeout(() => setStartNote(false), START_NOTE_MS);
      }}
      onWaiting={() => {
        const st = player.current?.state;
        if (started && st && !st.seeking && !st.paused) advisor.noteStall();
      }}
      onProviderChange={(provider: MediaProviderAdapter | null) => {
        // Bundle hls.js ourselves (lazy chunk) instead of letting Vidstack fetch it from a CDN.
        if (isHLSProvider(provider)) provider.library = () => import("hls.js");
      }}
      onCanPlay={() => {
        lockDefaultQuality();
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
      {startNote && !advisor.advice && <StartBanner fixed={qualityMenu?.current} onClose={() => setStartNote(false)} />}
      {advisor.advice && (
        <PlayerBanner
          place="side"
          title={advisor.advice.dir === "up" ? "Fast connection detected" : "Playback is struggling"}
          text={advisor.advice.dir === "up" ? `Switch to ${advisor.advice.to} for a sharper picture?` : `Switch to ${advisor.advice.to} for smoother playback?`}
          action="OK"
          onAction={advisor.accept}
          onClose={advisor.dismiss}
        />
      )}
      <DefaultVideoLayout
        icons={defaultLayoutIcons}
        noScrubGesture={false}
        slots={{
          ...(subtitles.length > 0 ? { afterCaptionButton: <SubtitleButton open={subOpen} onToggle={() => setSubOpen((o) => !o)} /> } : {}),
          ...(qualityMenu
            ? {
                settingsMenuItemsStart: (
                  <Menu.Root className="vds-quality-menu vds-menu">
                    <DefaultMenuButton label="Quality" hint={qualityMenu.current} Icon={defaultLayoutIcons.Menu.QualityUp} />
                    <Menu.Items className="vds-menu-items">
                      <DefaultMenuRadioGroup
                        value={qualityMenu.current}
                        options={qualityMenu.options.map((o) => ({ value: o.quality, label: o.cached ? o.quality : `${o.quality} · prepare` }))}
                        onChange={(q) => qualityMenu.onSelect(q, player.current?.state.currentTime ?? 0)}
                      />
                    </Menu.Items>
                  </Menu.Root>
                ),
              }
            : {}),
        }}
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

/** "Now streaming in 720p": the quality comes from the player's own state, so it is right even if the level settles after playback starts. */
function StartBanner({ fixed, onClose }: { fixed?: string; onClose: () => void }) {
  const height = useMediaState("quality")?.height;
  const quality = fixed ?? (height ? `${height}p` : null);
  return <PlayerBanner place="top" title={quality ? `Now streaming in ${quality}` : "Now streaming"} text="Change the quality anytime from the settings menu." onClose={onClose} />;
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
