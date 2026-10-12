"use client";

import { useActiveTextTrack, useCaptionOptions, useMediaPlayer, useMediaRemote, useMediaState, type TextTrack } from "@vidstack/react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { CloseIcon } from "./icons";
import {
  BG_COLORS,
  DEFAULT_STYLE,
  EDGES,
  FONTS,
  LIFT_MAX,
  SIZE_RANGE,
  styleVars,
  TEXT_COLORS,
  type SubStyle,
} from "./subtitle-style";
import {
  applyTiming,
  cueText,
  formatClock,
  formatShift,
  isNoTiming,
  loadTiming,
  NO_TIMING,
  nudge,
  originalStart,
  saveTiming,
  syncAt,
  type SubTiming,
} from "./subtitle-timing";

export type SubTab = "style" | "sync";
// Module-level: useActiveTextTrack resubscribes whenever this array changes identity.
const KINDS: ("subtitles" | "captions")[] = ["subtitles", "captions"];
/** Fine-tune step, also used by the G / H keys (VLC's subtitle delay keys). */
const STEP_S = 0.1;
/** Lines listed on each side of the picked one. */
const AROUND = 6;
const MAX_MATCHES = 40;

export function SubtitleButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="vds-button v-sub-btn" aria-label="Subtitle style and sync" aria-expanded={open} data-active={open || undefined} onClick={onToggle}>
      <svg className="vds-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
        <path d="M6.5 12.5h5M14.5 12.5h3M6.5 16h3M12.5 16h5" />
        <path d="M9 8.5h8" strokeDasharray="0 3" />
      </svg>
    </button>
  );
}

/**
 * In-player subtitle panel (works in fullscreen): language, look, and dialogue sync. Always
 * mounted while the player is, so a saved sync is applied as soon as a subtitle loads.
 */
export function SubtitleTools({
  open,
  tab,
  onTab,
  onClose,
  style,
  onStyle,
}: {
  open: boolean;
  tab: SubTab;
  onTab: (t: SubTab) => void;
  onClose: () => void;
  style: SubStyle;
  onStyle: (s: SubStyle) => void;
}) {
  const player = useMediaPlayer();
  const track = useActiveTextTrack(KINDS);
  const [timing, setTiming] = useState<SubTiming>(NO_TIMING);
  // Bumped when a subtitle finishes loading, so `ready` below is re-read.
  const [, setLoads] = useState(0);
  const ready = track?.readyState === 2;
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const panel = useRef<HTMLElement>(null);

  const now = () => player?.state.currentTime ?? 0;

  // Apply the saved correction whenever a subtitle is picked or finishes loading.
  useEffect(() => {
    if (!track) return;
    const load = () => {
      const t = loadTiming(track.id);
      applyTiming(track, t, player?.state.currentTime ?? 0);
      setTiming(t);
      setLoads((n) => n + 1);
    };
    if (track.readyState === 2) load();
    else track.addEventListener("load", load);
    return () => track.removeEventListener("load", load);
  }, [track, player]);

  const flash = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const update = (next: SubTiming, msg?: string) => {
    if (!track) return;
    applyTiming(track, next, now());
    saveTiming(track.id, next);
    setTiming(next);
    if (msg) flash(msg);
  };

  // G / H shift subtitles earlier / later, like VLC.
  const onDelayKey = useEffectEvent((e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if ((k !== "g" && k !== "h") || e.ctrlKey || e.metaKey || e.altKey || !ready) return;
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
    const next = nudge(timing, k === "g" ? -STEP_S : STEP_S);
    update(next, `Subtitle delay ${formatShift(next.offset)}`);
  });
  useEffect(() => {
    if (!track) return;
    window.addEventListener("keydown", onDelayKey);
    return () => window.removeEventListener("keydown", onDelayKey);
  }, [track]);

  const close = useEffectEvent(onClose);

  // Keys typed in the panel must not reach the player's shortcuts (space, arrows, f, c...).
  // Native listeners: Vidstack listens on the player element, below React's root listener.
  useEffect(() => {
    const el = panel.current;
    if (!el || !open) return;
    const stop = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      e.stopPropagation();
    };
    // Escape anywhere closes the panel first, instead of leaving the watch page.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || el.contains(e.target as Node)) return;
      e.stopPropagation();
      close();
    };
    el.addEventListener("keydown", stop);
    window.addEventListener("keydown", esc, true);
    el.focus({ preventScroll: true });
    return () => {
      el.removeEventListener("keydown", stop);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  return (
    <>
      {toast && (
        <div className="v-sub-toast" role="status">
          {toast}
        </div>
      )}
      <aside ref={panel} className="v-sub-panel" data-open={open} aria-hidden={!open} inert={!open} aria-label="Subtitles" tabIndex={-1}>
        <header className="v-sub-head">
          <div className="v-sub-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "style"} onClick={() => onTab("style")}>
              Style
            </button>
            <button type="button" role="tab" aria-selected={tab === "sync"} onClick={() => onTab("sync")}>
              Sync
              {!isNoTiming(timing) && <span className="v-sub-dot" aria-label="(adjusted)" />}
            </button>
          </div>
          <button type="button" className="v-bar-icon" aria-label="Close subtitle settings" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="v-sub-body">
          <LanguagePicker />
          {open && tab === "style" && <StyleTab style={style} onStyle={onStyle} />}
          {open && tab === "sync" &&
            (!track ? (
              <p className="v-sub-note">Turn on a subtitle above to sync it.</p>
            ) : !ready ? (
              <p className="v-sub-note">Loading subtitle…</p>
            ) : (
              <SyncTab track={track} timing={timing} onChange={update} />
            ))}
        </div>
      </aside>
    </>
  );
}

function LanguagePicker() {
  const options = useCaptionOptions({ off: "Off" });
  if (options.length <= 1) return null;
  return (
    <div className="v-sub-field">
      <span className="v-sub-label">Subtitle</span>
      <div className="v-sub-chips">
        {options.map((o) => (
          <button key={o.value} type="button" className="v-sub-chip" aria-pressed={o.selected} onClick={(e) => o.select(e.nativeEvent)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StyleTab({ style, onStyle }: { style: SubStyle; onStyle: (s: SubStyle) => void }) {
  const set = <K extends keyof SubStyle>(k: K, v: SubStyle[K]) => onStyle({ ...style, [k]: v });
  return (
    <>
      <div className="v-sub-preview" style={styleVars(style)}>
        <span>This is how subtitles will look.</span>
      </div>

      <label className="v-sub-field">
        <span className="v-sub-label">
          Size <output>{style.size}%</output>
        </span>
        <input type="range" min={SIZE_RANGE.min} max={SIZE_RANGE.max} step={SIZE_RANGE.step} value={style.size} onChange={(e) => set("size", Number(e.target.value))} />
      </label>

      <div className="v-sub-field">
        <span className="v-sub-label">Font</span>
        <div className="v-sub-chips">
          {(Object.keys(FONTS) as (keyof typeof FONTS)[]).map((f) => (
            <button key={f} type="button" className="v-sub-chip" aria-pressed={style.font === f} style={{ fontFamily: FONTS[f].css }} onClick={() => set("font", f)}>
              {FONTS[f].label}
            </button>
          ))}
          <button type="button" className="v-sub-chip" aria-pressed={style.bold} style={{ fontWeight: 700 }} onClick={() => set("bold", !style.bold)}>
            Bold
          </button>
        </div>
      </div>

      <Swatches label="Text colour" colors={TEXT_COLORS} value={style.color} onChange={(c) => set("color", c)} />

      <div className="v-sub-field">
        <span className="v-sub-label">Edge</span>
        <div className="v-sub-chips">
          {(Object.keys(EDGES) as (keyof typeof EDGES)[]).map((k) => (
            <button key={k} type="button" className="v-sub-chip" aria-pressed={style.edge === k} onClick={() => set("edge", k)}>
              {EDGES[k].label}
            </button>
          ))}
        </div>
      </div>

      <Swatches label="Background" colors={BG_COLORS} value={style.bg} onChange={(c) => onStyle({ ...style, bg: c, bgOpacity: style.bgOpacity || 75 })} />
      <label className="v-sub-field">
        <span className="v-sub-label">
          Background opacity <output>{style.bgOpacity}%</output>
        </span>
        <input type="range" min={0} max={100} step={5} value={style.bgOpacity} onChange={(e) => set("bgOpacity", Number(e.target.value))} />
      </label>

      <label className="v-sub-field">
        <span className="v-sub-label">
          Position <output>{style.lift ? `${style.lift}% higher` : "Bottom"}</output>
        </span>
        <input type="range" min={0} max={LIFT_MAX} step={2} value={style.lift} onChange={(e) => set("lift", Number(e.target.value))} />
      </label>

      <button type="button" className="v-btn v-btn-sm" onClick={() => onStyle(DEFAULT_STYLE)}>
        Reset to default
      </button>
    </>
  );
}

function Swatches({ label, colors, value, onChange }: { label: string; colors: string[]; value: string; onChange: (c: string) => void }) {
  const custom = !colors.includes(value.toLowerCase());
  return (
    <div className="v-sub-field">
      <span className="v-sub-label">{label}</span>
      <div className="v-sub-swatches">
        {colors.map((c) => (
          <button key={c} type="button" className="v-sub-swatch" style={{ background: c }} aria-label={c} aria-pressed={value.toLowerCase() === c} onClick={() => onChange(c)} />
        ))}
        <label className="v-sub-swatch v-sub-custom" aria-pressed={custom} title="Custom colour" style={custom ? { background: value } : undefined}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Custom ${label.toLowerCase()}`} />
        </label>
      </div>
    </div>
  );
}

/**
 * Dialogue sync: pause where a line is spoken, pick that line (step through with the arrows or
 * search), press Sync, and every subtitle moves so the line lands exactly there.
 */
function SyncTab({ track, timing, onChange }: { track: TextTrack; timing: SubTiming; onChange: (t: SubTiming, msg?: string) => void }) {
  const remote = useMediaRemote();
  const now = useMediaState("currentTime");
  const paused = useMediaState("paused");
  const [picked, setPicked] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const cues = track.cues;

  // Stop the video so the viewer can line up the dialogue they just heard.
  useEffect(() => {
    remote.pause();
  }, [remote]);

  // Until the viewer picks a line, follow the one on screen (or the last one before now).
  const current = useMemo(() => {
    let i = 0;
    while (i + 1 < cues.length && cues[i + 1].startTime <= now) i++;
    return i;
    // `timing` moves the cues in place, so the line on screen changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cues, now, timing]);
  const pick = Math.min(picked ?? current, cues.length - 1);
  const cue = cues[pick];

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    if (q) {
      const out: number[] = [];
      for (let i = 0; i < cues.length && out.length < MAX_MATCHES; i++) if (cueText(cues[i]).toLowerCase().includes(q)) out.push(i);
      return out;
    }
    const from = Math.max(0, pick - AROUND);
    return Array.from({ length: Math.min(cues.length, pick + AROUND + 1) - from }, (_, k) => from + k);
  }, [q, cues, pick]);

  // Keep the picked line in view as the viewer steps through.
  useEffect(() => {
    const box = list.current;
    const el = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!box || !el) return;
    box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
  }, [pick, rows]);

  if (!cue) return <p className="v-sub-note">This subtitle has no lines.</p>;

  const shift = now - cue.startTime;
  const step = (d: number) => setPicked(Math.max(0, Math.min(cues.length - 1, pick + d)));
  const seek = (d: number) => remote.seek(Math.max(0, now + d));
  const sync = () => {
    const next = syncAt(timing, originalStart(cue), now);
    onChange(next, next.anchors.length === 2 ? "Synced at two points: speed drift fixed too" : `Synced: subtitles ${formatShift(next.offset)}`);
    setPicked(null);
    setQuery("");
  };

  return (
    <div className="v-sub-sync">
      <ol className="v-sub-steps">
        <li>Pause right when someone speaks.</li>
        <li>Pick the line they said, using ‹ › or search.</li>
        <li>Press <b>Sync</b>. Repeat later in the video to fix drift.</li>
      </ol>

      <div className="v-sub-transport">
        <button type="button" className="v-btn v-btn-sm" onClick={() => seek(-3)} aria-label="Back 3 seconds">−3s</button>
        <button type="button" className="v-btn v-btn-sm" onClick={() => remote.togglePaused()}>
          {paused ? "Play" : "Pause"}
        </button>
        <button type="button" className="v-btn v-btn-sm" onClick={() => seek(3)} aria-label="Forward 3 seconds">+3s</button>
        <span className="v-sub-clock">{formatClock(now)}</span>
      </div>

      <div className="v-sub-pick">
        <button type="button" className="v-bar-icon" onClick={() => step(-1)} disabled={pick === 0} aria-label="Previous line">‹</button>
        <blockquote>
          <small>Line {pick + 1} of {cues.length} · now at {formatClock(cue.startTime)}</small>
          <p>{cueText(cue) || "(no text)"}</p>
        </blockquote>
        <button type="button" className="v-bar-icon" onClick={() => step(1)} disabled={pick === cues.length - 1} aria-label="Next line">›</button>
      </div>

      <button type="button" className="v-btn v-btn-primary v-sub-syncbtn" onClick={sync}>
        Sync this line to {formatClock(now)}
        <small>{Math.abs(shift) < 0.05 ? "already in sync" : `moves subtitles ${formatShift(shift)}`}</small>
      </button>

      <input type="search" className="v-sub-search" placeholder="Search dialogue…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search dialogue" />
      <ol className="v-sub-lines" ref={list} role="listbox" aria-label="Subtitle lines">
        {rows.length === 0 && <li className="v-sub-note">No line matches “{query}”.</li>}
        {rows.map((i) => (
          <li key={i} role="option" aria-selected={i === pick} data-now={i === current || undefined} onClick={() => setPicked(i)}>
            <time>{formatClock(cues[i].startTime)}</time>
            <span>{cueText(cues[i])}</span>
          </li>
        ))}
      </ol>

      <div className="v-sub-field">
        <span className="v-sub-label">
          Fine-tune <output>{formatShift(timing.offset)}{timing.scale !== 1 && ` · speed ${(timing.scale * 100).toFixed(2)}%`}</output>
        </span>
        <div className="v-sub-nudge">
          <button type="button" className="v-btn v-btn-sm" onClick={() => onChange(nudge(timing, -1))}>−1s</button>
          <button type="button" className="v-btn v-btn-sm" onClick={() => onChange(nudge(timing, -STEP_S))}>−0.1s</button>
          <button type="button" className="v-btn v-btn-sm" onClick={() => onChange(nudge(timing, STEP_S))}>+0.1s</button>
          <button type="button" className="v-btn v-btn-sm" onClick={() => onChange(nudge(timing, 1))}>+1s</button>
        </div>
        <small className="v-sub-hint">− shows lines earlier, + later. Keys: G / H.</small>
      </div>

      {!isNoTiming(timing) && (
        <button type="button" className="v-btn v-btn-sm v-btn-danger" onClick={() => onChange(NO_TIMING, "Subtitle timing reset")}>
          Reset timing
        </button>
      )}
    </div>
  );
}
