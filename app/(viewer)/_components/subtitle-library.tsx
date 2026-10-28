"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import type { WatchSubtitle } from "@/lib/viewer/watch";
import type { SinhalaTarget } from "./sinhala-subtitles";
import { PlayerBanner } from "./player-banner";
import { CaptionsIcon, CheckIcon, CloseIcon, UploadIcon } from "./icons";

export const libraryId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
export const sourceLabel = (s: WatchSubtitle) => ({ auto: "Auto", opensubtitles: "OpenSubtitles", upload: "Uploaded", translation: "Translation" }[s.source ?? "auto"]);
export const rankTracks = (tracks: WatchSubtitle[]) => [...tracks].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || new Date(b.lastUsedAt ?? 0).getTime() - new Date(a.lastUsedAt ?? 0).getTime() || a.id.localeCompare(b.id));

export function useSubtitleLibrary({ target, initial }: { target?: SinhalaTarget; initial: WatchSubtitle[] }) {
  const [stored, setStored] = useState<WatchSubtitle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(Boolean(target));
  const [needsChoice, setNeedsChoice] = useState(false);
  const [message, setMessage] = useState("");
  const dismiss = useCallback(() => setNeedsChoice(false), []);
  const key = target ? `${target.mediaType}:${target.tmdbId}:${target.season ?? 0}:${target.episode ?? 0}` : "";
  const add = useCallback((track: WatchSubtitle) => {
    setStored((all) => rankTracks([...all.filter((t) => t.id !== track.id), track]));
    setNeedsChoice(false);
  }, []);
  useEffect(() => {
    if (!target) return;
    const ctrl = new AbortController();
    const load = async () => {
      setBusy(true);
      try {
        const location = new URL(window.location.href);
        const invite = location.searchParams.get("subtitleInvite");
        if (invite) {
          const accepted = await fetchWithRefresh("/api/subtitles/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invite }), signal: ctrl.signal });
          if (!accepted.ok) throw new Error("This subtitle invitation is invalid or expired");
          location.searchParams.delete("subtitleInvite"); window.history.replaceState(null, "", location);
        }
        const query = new URLSearchParams(Object.entries(target).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
        const res = await fetchWithRefresh(`/api/subtitles?${query}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error("Could not load the subtitle library");
        const data = await res.json() as { tracks: WatchSubtitle[] };
        setStored(rankTracks(data.tracks));
        setLoaded(true);
        if (!data.tracks.some((s) => s.language === "en")) {
          const auto = await fetchWithRefresh("/api/subtitles/auto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(target), signal: ctrl.signal });
          const result = await auto.json() as { track?: WatchSubtitle; needsChoice?: boolean; message?: string };
          if (!auto.ok) throw new Error(result.message ?? "Could not find automatic subtitles");
          if (result.track) add(result.track);
          else { setNeedsChoice(Boolean(result.needsChoice)); setMessage(result.message ?? "Choose or upload another subtitle"); }
        }
      } catch (e) {
        if (!ctrl.signal.aborted) setMessage(e instanceof Error ? e.message : "Subtitle library is unavailable");
      } finally { if (!ctrl.signal.aborted) setBusy(false); }
    };
    void load();
    return () => ctrl.abort();
    // Title metadata is fixed for a mounted player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, add]);
  const seed = loaded ? initial.filter((t) => !libraryId(t.id)) : initial;
  const merged = new Map([...seed, ...stored].map((t) => [t.id, t]));
  // Stored tracks supersede temporary engine tracks of the same language.
  const tracks = rankTracks([...merged.values()].filter((t) => libraryId(t.id) || !stored.some((s) => s.language === t.language)));
  return { tracks, add, busy, needsChoice, message, dismiss };
}

type Candidate = { ref: string; release: string; downloads: number; rating: number | null; lang: string; fileName: string };
type Mode = "library" | "search" | "upload";
const LANGUAGES = [["en", "English"], ["si", "Sinhala"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"], ["it", "Italian"], ["ar", "Arabic"], ["ru", "Russian"], ["hi", "Hindi"]];
const REPORTS = [["out_of_sync", "Out of sync"], ["wrong_language", "Wrong language"], ["wrong_movie", "Wrong movie"]];

/**
 * Choose, find or upload a subtitle. A side sheet in the same style as the subtitle settings panel, so the video
 * stays visible on the left while the viewer picks.
 */
export function SubtitleLibraryPicker({ target, tracks, currentId, onPick, onAdd, onClose, onTranslate, initialMode = "library", intro }: {
  target?: SinhalaTarget;
  tracks: WatchSubtitle[];
  /** The track showing in the slot being changed, marked as current. */
  currentId?: string;
  onPick: (track: WatchSubtitle) => void;
  onAdd: (track: WatchSubtitle) => void;
  onClose: () => void;
  onTranslate: (track: WatchSubtitle) => void;
  initialMode?: "library" | "search";
  /** A short explanation at the top, e.g. why the sheet was suggested. */
  intro?: string;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [lang, setLang] = useState("en");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, summary, [tabindex="0"]') ?? [])];
        const index = nodes.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (index <= 0 ? nodes.length - 1 : index - 1) : (index + 1) % nodes.length;
        if (nodes[next]) { e.preventDefault(); nodes[next].focus(); }
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("keydown", escape, true); previous?.focus(); };
  }, [onClose]);
  useEffect(() => {
    if (mode !== "search" || !target) return;
    const ctrl = new AbortController();
    const search = async () => {
      setBusy(true); setError("");
      try {
        const q = new URLSearchParams(Object.entries({ ...target, lang }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
        const res = await fetchWithRefresh(`/api/subtitles/search?${q}`, { signal: ctrl.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? "We couldn’t search for subtitles right now. Try again in a moment.");
        setCandidates(body.candidates);
      } catch (e) { if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "We couldn’t search for subtitles right now. Try again in a moment."); }
      finally { if (!ctrl.signal.aborted) setBusy(false); }
    };
    void search();
    return () => ctrl.abort();
  }, [mode, target, lang]);
  const switchTo = (m: Mode) => { setMode(m); setError(""); setNote(""); };
  const accept = async (request: () => Promise<Response>) => {
    setBusy(true); setError("");
    try {
      const res = await request();
      const body = await res.json();
      if (!res.ok || !body.track) throw new Error(body.message ?? "That subtitle didn’t load. Try another one.");
      onAdd(body.track); onPick(body.track);
    } catch (e) { setError(e instanceof Error ? e.message : "That subtitle didn’t load. Try another one."); }
    finally { setBusy(false); }
  };
  const feedback = async (trackId: string, action: "good" | "report", reason?: string) => {
    const res = await fetchWithRefresh("/api/subtitles/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackId, action, reason }) }).catch(() => null);
    setNote(res?.ok ? action === "good" ? "Thanks! That helps other viewers pick." : "Problem reported. Thank you." : "Could not save your feedback. Try again.");
  };
  const invite = async (trackId: string) => {
    try {
      const res = await fetchWithRefresh("/api/subtitles/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Could not create an invitation");
      const link = new URL(window.location.href); link.searchParams.set("subtitleInvite", data.invite);
      await navigator.clipboard.writeText(link.toString());
      setNote("Link copied. It works for 7 days. If three people watch with it, everyone can use your subtitle.");
    } catch (e) { setNote(e instanceof Error ? e.message : "Could not copy this invitation"); }
  };
  const upload = (file: File | undefined) => {
    if (!file || !target) return;
    if (file.size > 2 * 1024 * 1024) return setError("That file is too big. Subtitles must be 2 MB or smaller.");
    const form = new FormData();
    Object.entries(target).forEach(([k, v]) => { if (v !== undefined) form.set(k, String(v)); });
    form.set("file", file); form.set("language", lang);
    void accept(() => fetchWithRefresh("/api/subtitles/upload", { method: "POST", body: form }));
  };
  const usable = tracks.filter((t) => t.url);
  const tab = (m: Mode, label: string) => <button type="button" role="tab" aria-selected={mode === m} onClick={() => switchTo(m)}>{label}</button>;
  return (
    <div className="v-sub-sheet-backdrop" onClick={onClose}>
      <div ref={panel} className="v-sub-panel v-sub-sheet" data-open="true" role="dialog" aria-modal="true" aria-label="Subtitle library" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <header className="v-sub-head">
          <div className="v-sub-tabs" role="tablist" aria-label="Subtitle options">
            {tab("library", "Available")}
            {target && <>{tab("search", "Find more")}{tab("upload", "Upload")}</>}
          </div>
          <button ref={first} type="button" className="v-bar-icon" aria-label="Close subtitle library" onClick={onClose}><CloseIcon size={18} /></button>
        </header>
        <div className="v-sub-body">
          {intro && <div className="v-sub-callout"><CaptionsIcon size={18} /><p>{intro}</p></div>}
          {mode !== "library" && (
            <label className="v-sub-field">
              <span className="v-sub-label">Language</span>
              <select className="v-sub-select" aria-label="Subtitle language" value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </label>
          )}
          {busy && <div className="v-sub-busy" role="status"><span className="v-spin" aria-hidden="true" />{mode === "search" ? "Searching subtitles…" : "Getting your subtitle ready…"}</div>}
          {error && <p className="v-sub-msg" data-tone="error" role="alert">{error}</p>}
          {note && <p className="v-sub-msg" role="status">{note}</p>}

          {mode === "library" && (usable.length ? (
            <ul className="v-sub-list">
              {usable.map((t, i) => {
                const current = t.id === currentId;
                return (
                  <li key={t.id} className="v-sub-item" data-current={current || undefined}>
                    <button type="button" className="v-sub-item-main" aria-label={`Use ${t.label} (${sourceLabel(t)})`} aria-pressed={current} onClick={() => onPick(t)}>
                      <span className="v-sub-item-title">{t.label}</span>
                      <span className="v-sub-item-meta">
                        <span className="v-sub-badge">{sourceLabel(t)}</span>
                        {i === 0 && (t.score ?? 0) > 0 && <span className="v-sub-badge" data-tone="gold">Top rated</span>}
                        {t.visibility === "private" && <span className="v-sub-badge">Only you</span>}
                      </span>
                      <span className="v-sub-item-use">{current ? <><CheckIcon size={16} />On</> : "Use"}</span>
                    </button>
                    {libraryId(t.id) && (
                      <div className="v-sub-item-actions">
                        {t.language === "en" && <button type="button" className="v-sub-link" onClick={() => onTranslate(t)}>Translate to Sinhala</button>}
                        {t.canShare && t.visibility === "private" && <button type="button" className="v-sub-link" onClick={() => void invite(t.id)}>Share with a friend</button>}
                        <button type="button" className="v-sub-link" onClick={() => void feedback(t.id, "good")}>Works well</button>
                        <details className="v-sub-report">
                          <summary className="v-sub-link">Report a problem</summary>
                          <div className="v-sub-chips">{REPORTS.map(([reason, label]) => <button key={reason} type="button" className="v-sub-chip" onClick={() => void feedback(t.id, "report", reason)}>{label}</button>)}</div>
                        </details>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="v-sub-empty">
              <p>No subtitles for this title yet.</p>
              {target && <button type="button" className="v-btn v-btn-primary v-btn-sm" onClick={() => switchTo("search")}>Find subtitles</button>}
            </div>
          ))}

          {mode === "search" && !busy && (candidates.length ? (
            <ul className="v-sub-list">
              {candidates.map((c) => (
                <li key={c.ref} className="v-sub-item">
                  <button type="button" className="v-sub-item-main" aria-label={`Use ${c.release || c.fileName}`} onClick={() => void accept(() => fetchWithRefresh("/api/subtitles/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: c.ref }) }))}>
                    <span className="v-sub-item-title">{c.release || c.fileName}</span>
                    <span className="v-sub-item-meta">{c.downloads.toLocaleString()} downloads{c.rating !== null ? ` · rated ${c.rating}/10` : ""}</span>
                    <span className="v-sub-item-use">Use</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : !error && (
            <div className="v-sub-empty">
              <p>Nothing found in this language. Try another language, or upload your own file.</p>
              <button type="button" className="v-btn v-btn-sm" onClick={() => switchTo("upload")}>Upload a file</button>
            </div>
          ))}

          {mode === "upload" && (
            <label className="v-sub-drop" data-busy={busy || undefined}>
              <UploadIcon size={22} />
              <strong>Choose a subtitle file</strong>
              <span>SRT or VTT, up to 2 MB. Only you can see it until others try it.</span>
              <input aria-label="Upload subtitle file" type="file" accept=".srt,.vtt" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Shown instead of opening the picker by itself when no English subtitle could be found automatically: a small side
 * alert the viewer can act on or ignore, like the quality suggestion.
 */
export function SubtitleSuggestion({ onFind, onClose }: { onFind: () => void; onClose: () => void }) {
  return (
    <PlayerBanner
      place="side"
      title="No subtitles found automatically"
      text="Want subtitles? We can search more sources for you. It only takes a few seconds."
      action="Find subtitles"
      onAction={onFind}
      onClose={onClose}
    />
  );
}

/** Count actual playing time, excluding seeking, stalls and pauses; the server also checks elapsed time. */
export function useSubtitlePlays() {
  const counts = useRef(new Map<string, { playId: string; seconds: number; sent: boolean; attempts: number; lastAttempt: number }>());
  const last = useRef(0);
  const tick = (ids: string[], playing: boolean) => {
    const now = performance.now();
    const elapsed = last.current ? Math.min(2, Math.max(0, (now - last.current) / 1000)) : 0;
    last.current = now;
    if (!playing) return;
    for (const trackId of ids.filter(libraryId)) {
      let entry = counts.current.get(trackId);
      if (!entry) {
        entry = { playId: crypto.randomUUID(), seconds: 0, sent: false, attempts: 0, lastAttempt: 0 }; counts.current.set(trackId, entry);
        void fetchWithRefresh("/api/subtitles/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackId, action: "start", playId: entry.playId }) });
      }
      entry.seconds += elapsed;
      if (entry.seconds >= 60 && !entry.sent && entry.attempts < 3 && entry.seconds - entry.lastAttempt >= 2) {
        entry.sent = true;
        entry.attempts++; entry.lastAttempt = entry.seconds;
        void fetchWithRefresh("/api/subtitles/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackId, action: "played", playId: entry.playId, seconds: entry.seconds }) }).then(async (r) => { const data = await r.json(); if (!r.ok || !data.credited) entry!.sent = false; }).catch(() => { entry!.sent = false; });
      }
    }
  };
  return tick;
}

export function SubtitleLibraryBanner({ busy }: { busy: boolean }) {
  const [hidden, setHidden] = useState(false);
  return busy && !hidden ? <PlayerBanner place="start" title="Finding English subtitles…" text="Playback continues while we check available tracks." onClose={() => setHidden(true)} /> : null;
}
