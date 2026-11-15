"use client";

import "vidstack/player/styles/default/theme.css";
import "vidstack/player/styles/default/layouts/video.css";
import { MediaPlayer, MediaProvider, Menu, Track, useMediaState, type MediaPlayerInstance, type MediaProviderAdapter } from "@vidstack/react";
import { defaultLayoutIcons, DefaultMenuButton, DefaultMenuRadioGroup, DefaultVideoLayout } from "@vidstack/react/player/layouts/default";
import { isHLSProvider } from "vidstack";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import { CenterPlayButton, CenterSkipButton } from "./center-controls";
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
import { takeBusyWaited, useFeedbackMoments } from "./feedback-moments";
import { useSinhalaSubtitles, type SinhalaTarget } from "./sinhala-subtitles";
import { SubtitleButton, SubtitleTools, type SubTab } from "./subtitle-tools";
import { DualSubtitles, useDualSubtitleSelection, type SubtitleSlot, type SubtitleStyles } from "./dual-subtitles";
import { usePlayerFeedback } from "./player-feedback";
import { libraryId, rankTracks, SubtitleLibraryBanner, SubtitleLibraryPicker, SubtitleSuggestion, useSubtitleLibrary, useSubtitlePlays } from "./subtitle-library";
import { PENDING_ID } from "./sinhala-subtitles";
import { warmHls } from "./player-loaders";

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
const START_NOTE_MS = 6000;
/** First ABR guess (bps): the browser's downlink hint, heavily discounted so the first fragment is small and the
 *  first frame comes fast (ABR ramps up from measured throughput); capped because Chrome reports up to 10 Mbps
 *  and a top-rung first fragment can be several MB. hls.js's 500 kbps default when there is no hint. */
const initialBandwidth = () => {
  const mbps = (navigator as Navigator & { connection?: { downlink?: number } }).connection?.downlink;
  return mbps && Number.isFinite(mbps) ? Math.min(1.5e6, Math.max(3e5, mbps * 1e6 * 0.35)) : 5e5;
};
/** How long the video must stay paused before the "You are watching" poster appears. */
const PAUSE_OVERLAY_DELAY_MS = 3 * 60_000;

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
  sinhala,
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
  /** Which title the "Sinhala (AI)" subtitles are made for on demand; omitted = no such option. */
  sinhala?: SinhalaTarget;
}) {
  const player = useRef<MediaPlayerInstance>(null);
  const mediaKey = track ? `${track.kind}:${track.id}` : sinhala ? `${sinhala.mediaType}:${sinhala.tmdbId}:${sinhala.season ?? 0}:${sinhala.episode ?? 0}` : title;
  const [rememberedChoices] = useState<string[]>(() => {
    try {
      if (localStorage.getItem(`v-sub-explicit:${mediaKey}`) !== "1") return [];
      const value = JSON.parse(localStorage.getItem(`v-sub-choice:${mediaKey}`) ?? "[]");
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    } catch { return []; }
  });
  const library = useSubtitleLibrary({ target: sinhala, initial: subtitles ?? [] });
  const [sourceTrackId, setSourceTrackId] = useState<string | undefined>();
  const englishSource = library.tracks.find((s) => s.id === sourceTrackId && s.language === "en") ?? library.tracks.find((s) => s.language === "en" && rememberedChoices.includes(s.id)) ?? library.tracks.find((s) => s.language === "en" && libraryId(s.id));
  const translationTarget = useMemo(() => sinhala ? { ...sinhala, sourceTrackId: englishSource?.id } : undefined, [sinhala, englishSource?.id]);
  const si = useSinhalaSubtitles({ target: translationTarget, subtitles: library.tracks, onReady: library.add });
  const allSubtitles = rankTracks(si.tracks);
  const defaultSub = (allSubtitles.find((s) => s.url && isSinhala(s.language)) ?? allSubtitles.find((s) => isEnglish(s.language)))?.id;
  const dual = useDualSubtitleSelection({ mediaKey, subtitles: allSubtitles, defaultId: defaultSub, generatedTrack: si.generatedTrack, requestSinhala: si.request, ready: !library.busy });
  const countSubtitlePlay = useSubtitlePlays();
  // The picker never opens by itself: when no subtitle was found automatically, a side alert suggests it first.
  const [picker, setPicker] = useState<{ slot: SubtitleSlot; mode: "library" | "search"; intro?: string } | null>(null);
  const [pendingTranslate, setPendingTranslate] = useState<{ slot: SubtitleSlot; id: string } | null>(null);
  const translatedRequest = useRef<typeof pendingTranslate>(null);
  const dismissLibraryChoice = library.dismiss;
  const closePicker = useCallback(() => { setPicker(null); dismissLibraryChoice(); }, [dismissLibraryChoice]);
  useEffect(() => {
    if (pendingTranslate && pendingTranslate !== translatedRequest.current && englishSource?.id === pendingTranslate.id) {
      const existing = allSubtitles.find((s) => s.language === "si" && s.originTrackId === pendingTranslate.id);
      if (existing) { dual.select(pendingTranslate.slot, existing.id); translatedRequest.current = pendingTranslate; }
      else if (allSubtitles.some((s) => s.id === PENDING_ID)) { dual.select(pendingTranslate.slot, PENDING_ID); translatedRequest.current = pendingTranslate; }
    }
  }, [pendingTranslate, englishSource?.id, allSubtitles, dual]);
  const lastSave = useRef(0);
  const [resumeAt] = useState(() => Number.isFinite(startAt) && startAt > 0 ? startAt : 0);
  const seekTo = useRef(resumeAt);
  const guardResume = (duration: number) => {
    if (seekTo.current <= 0 || !Number.isFinite(duration) || duration <= 0 || seekTo.current < duration - 5) return false;
    seekTo.current = 0;
    if (player.current) player.current.currentTime = 0;
    return true;
  };

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

  // Space toggles playback in one press. Vidstack's own handler skips Space while a button has focus, and once
  // the controls hide its first key press only wakes them, so a mouse-clicked button cost a second press.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      // Typing, menus, dialogs and keyboard-focused buttons keep their own Space behaviour.
      if (el?.closest("input, textarea, select, [contenteditable], [role^='menu'], [role='listbox'], [role='option'], [role='dialog'], [role='slider']")) return;
      if (el?.matches("button:focus-visible, [role='button']:focus-visible")) return;
      const p = player.current;
      if (!p) return;
      e.preventDefault();
      e.stopPropagation();
      if (p.paused) void p.play().catch(() => {});
      else void p.pause().catch(() => {});
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);
  const resumed = () => {
    clearTimeout(pauseTimer.current);
    setPaused(false);
  };

  const [subOpen, setSubOpen] = useState(false);
  // Notification banners step aside while the viewer is busy in the subtitle panel or the picker.
  const overlay = subOpen || Boolean(picker);
  const [subTab, setSubTab] = useState<SubTab>("tracks");
  const [subSlot, setSubSlot] = useState<SubtitleSlot>(0);
  // Client-only component (dynamic, ssr: false), so localStorage is safe to read here.
  const [subStyles, setSubStyles] = useState<SubtitleStyles>(() => [loadStyle(0), loadStyle(1)]);
  const changeSubStyle = (s: SubStyle) => {
    setSubStyles((prev) => subSlot === 0 ? [s, prev[1]] : [prev[0], s]);
    saveStyle(s, subSlot);
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

  // Before mount Vidstack renders the source as <source> children; with native HLS (Safari, recent Chrome) the browser
  // starts fetching the stream from them and competes with hls.js until MSE takes over. Hand over the source a frame later.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const candidates = playbackCandidates(source.kind, source.url, hint);
  const current = candidates[Math.min(attempt, candidates.length - 1)];
  const insecure = typeof window !== "undefined" && window.location.protocol === "https:" && source.url.startsWith("http:");

  // HLS adapts by default; selecting a rendition in Vidstack still switches to manual quality.
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
  const advisor = useQualityAdvisor({
    active: started,
    // ABR already handles connection changes; suggestions remain useful for manual choices.
    current: () => !qualityMenu && player.current?.qualities.auto ? null : nowQuality(),
    offered: offeredQualities,
    readMbps,
    onSwitch: switchTo,
  });
  // One question per viewing, whichever asks first: the experience survey or a small question about a feature.
  const viewing = useRef({ asked: false });
  const feedback = usePlayerFeedback({
    mediaKey,
    title,
    track,
    viewing,
    context: () => ({ position: player.current?.state.currentTime ?? 0, duration: player.current?.state.duration ?? 0, quality: nowQuality() }),
  });
  const moments = useFeedbackMoments({
    mediaKey,
    title,
    viewing,
    // Only when nothing else is on screen: no panel, picker, suggestion or survey.
    calm: () => !overlay && !advisor.advice && !library.needsChoice && !feedback.survey,
    context: () => ({ quality: nowQuality(), position: Math.round(player.current?.state.currentTime ?? 0) }),
  });
  const fireMoment = moments.moment;
  useEffect(() => {
    if (takeBusyWaited()) fireMoment("busy_waited", { afterPlayMs: 30_000 });
  }, [fireMoment]);

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
      src={mounted ? current : undefined}
      currentTime={resumeAt}
      style={styleVars(subStyles[0])}
      playsInline
      autoPlay
      keyTarget="document"
      keyShortcuts={{ toggleCaptions: { keys: "c", callback: () => setSubOpen((open) => !open) } }}
      onPlaying={() => {
        if (started) return;
        setStarted(true);
        setStartNote(true);
        clearTimeout(noteTimer.current);
        noteTimer.current = setTimeout(() => setStartNote(false), START_NOTE_MS);
      }}
      onWaiting={() => {
        countSubtitlePlay([], false);
        const st = player.current?.state;
        if (started && st && !st.seeking && !st.paused) {
          advisor.noteStall();
          feedback.onStall();
        }
      }}
      onProviderChange={(provider: MediaProviderAdapter | null) => {
        // Bundle hls.js ourselves (lazy chunk) instead of letting Vidstack fetch it from a CDN.
        if (isHLSProvider(provider)) {
          // Must be an arrow: Vidstack treats anything with a `prototype` as the hls.js constructor itself.
          provider.library = () => warmHls();
          // Same reason: the m3u8 <source> Vidstack appends for reference would start a native HLS load. hls.js
          // plays from an MSE blob, so the element never needs it.
          (provider as unknown as { appendSource: () => void }).appendSource = () => {};
          // Let ABR choose the first rendition from its bandwidth estimate, capped to the viewport.
          // testBandwidth: false — otherwise hls.js downloads a first fragment only to measure throughput and
          // discards it, so the first frame waits for a second (often much larger) fragment.
          provider.config = { ...provider.config, startLevel: -1, testBandwidth: false, abrEwmaDefaultEstimate: initialBandwidth(), capLevelToPlayerSize: true, startPosition: seekTo.current };
          provider.onInstance((hls) => {
            const event = provider.ctor!.Events.LEVEL_UPDATED;
            // Playlist duration is known here, before the stream controller requests its first fragment.
            hls.once(event, (_event, data) => {
              if (!data.details.live && guardResume(data.details.totalduration)) hls.startLoad(0);
            });
          });
        }
      }}
      onLoadedMetadata={() => { guardResume(player.current?.state.duration ?? 0); }}
      onCanPlay={() => {
        const at = seekTo.current;
        seekTo.current = 0;
        const duration = player.current?.state.duration ?? 0;
        if (at > 0 && player.current) player.current.currentTime = !duration || at < duration - 5 ? at : 0;
      }}
      onTimeUpdate={() => {
        if (Date.now() - lastSave.current >= SAVE_EVERY_MS) save();
        const st = player.current?.state;
        feedback.onTime(Boolean(st?.playing && !st.waiting && !st.seeking));
        moments.onTime(Boolean(st?.playing && !st.waiting && !st.seeking));
        const readyIds = dual.selection.filter((id): id is string => Boolean(id && [...(player.current?.textTracks ?? [])].some((t) => t.id === id && t.readyState === 2)));
        countSubtitlePlay(readyIds, Boolean(st?.playing && !st.waiting && !st.seeking));
      }}
      onPlay={() => {
        countSubtitlePlay([], false);
        resumed();
        feedback.onPlay();
      }}
      onSeeking={() => { countSubtitlePlay([], false); resumed(); moments.onSeek(); }}
      onPause={() => {
        countSubtitlePlay([], false);
        save();
        const s = player.current?.state;
        if (s?.ended || s?.seeking) return;
        feedback.onPause();
        clearTimeout(pauseTimer.current);
        pauseTimer.current = setTimeout(() => setPaused(true), PAUSE_OVERLAY_DELAY_MS);
      }}
      onEnded={() => {
        resumed();
        save();
        feedback.onEnded();
      }}
      onError={() => {
        if (attempt + 1 < candidates.length) setAttempt(attempt + 1);
        else setFailed(true);
      }}
    >
      <MediaProvider>
        {allSubtitles.map((s) => (
          <Track
            key={s.id}
            {...(s.url ? { src: s.url } : { content: "WEBVTT\n" })}
            kind="subtitles"
            type={s.format}
            label={s.label}
            lang={s.language}
            id={s.id}
          />
        ))}
      </MediaProvider>
      <DualSubtitles selection={dual.selection} styles={subStyles} mediaKey={mediaKey} />
      {!overlay && <SubtitleLibraryBanner busy={library.busy} />}
      {info && paused && !subOpen && <PauseOverlay info={info} />}
      {!overlay && si.banner}
      {!overlay && startNote && !advisor.advice && <StartBanner fixed={qualityMenu?.current} onClose={() => setStartNote(false)} />}
      {!overlay && feedback.survey}
      {!overlay && !feedback.survey && moments.card}
      {!overlay && !feedback.survey && !moments.card && !advisor.advice && library.needsChoice && (
        <SubtitleSuggestion
          onFind={() => setPicker({ slot: 0, mode: "search", intro: "We couldn’t find subtitles for this automatically. Pick one below, or upload your own." })}
          onClose={dismissLibraryChoice}
        />
      )}
      {!overlay && !feedback.survey && !moments.card && advisor.advice && (
        <PlayerBanner
          place="side"
          title={advisor.advice.dir === "up" ? "Fast connection detected" : "Playback is struggling"}
          text={advisor.advice.dir === "up" ? `Switch to ${advisor.advice.to} for a sharper picture?` : `Switch to ${advisor.advice.to} for smoother playback?`}
          action="OK"
          onAction={() => {
            moments.moment("quality_switched", { afterPlayMs: 2 * 60_000, context: { to: advisor.advice?.to ?? null } });
            advisor.accept();
          }}
          onClose={advisor.dismiss}
        />
      )}
      <DefaultVideoLayout
        icons={defaultLayoutIcons}
        noScrubGesture={false}
        slots={{
          captionButton: null,
          captions: null,
          // Big controls in the middle: skip back, play/pause, skip forward. The compact layout already
          // renders its own centre play button, so it gets ours in that slot instead.
          centerControlsGroupStart: <CenterSkipButton />,
          centerControlsGroupCenter: <CenterPlayButton />,
          centerControlsGroupEnd: <CenterSkipButton forward />,
          smallLayout: { centerControlsGroupCenter: null, playButton: <CenterPlayButton /> },
          afterCaptionButton: <SubtitleButton open={subOpen} onToggle={() => setSubOpen((o) => !o)} />,
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
      {(
        <SubtitleTools
          open={subOpen}
          tab={subTab}
          onTab={setSubTab}
          onClose={closeSubPanel}
          subtitles={allSubtitles}
          selection={dual.selection}
          choices={dual.choices}
          onSelect={(slot, id) => {
            if (id && allSubtitles.some((s) => s.id === id && s.language === "en" && libraryId(s.id))) setSourceTrackId(id);
            dual.select(slot, id);
          }}
          mediaKey={mediaKey}
          onMore={(slot) => { setSubOpen(false); setPicker({ slot, mode: "library" }); }}
          slot={subSlot}
          onSlot={setSubSlot}
          style={subStyles[subSlot]}
          onStyle={changeSubStyle}
          note={si.unavailableNote}
          notice={si.banner}
        />
      )}
      {picker && <SubtitleLibraryPicker target={sinhala} tracks={allSubtitles} currentId={dual.selection[picker.slot] ?? undefined} initialMode={picker.mode} intro={picker.intro} onClose={closePicker}
        onAdd={library.add} onPick={(s) => {
          if (s.language === "en" && libraryId(s.id)) setSourceTrackId(s.id);
          dual.select(picker.slot, s.id);
          closePicker();
          moments.moment(isSinhala(s.language) ? "sinhala_watched" : "subtitle_picked", { afterPlayMs: 5 * 60_000, context: { subtitle: s.id, source: s.source ?? "auto", language: s.language } });
        }}
        onTranslate={(s) => {
          setSourceTrackId(s.id);
          setPendingTranslate({ slot: picker.slot, id: s.id });
          closePicker();
          moments.moment("sinhala_watched", { afterPlayMs: 5 * 60_000, context: { source: s.id } });
        }} />}
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
