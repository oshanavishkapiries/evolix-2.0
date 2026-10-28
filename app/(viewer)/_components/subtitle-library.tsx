"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import type { WatchSubtitle } from "@/lib/viewer/watch";
import type { SinhalaTarget } from "./sinhala-subtitles";
import { PlayerBanner } from "./player-banner";
import { PlayerStatus } from "./player-status";
import { CloseIcon } from "./icons";

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
export function SubtitleLibraryPicker({ target, tracks, onPick, onAdd, onClose, onTranslate, initialMode = "library", message }: {
  target?: SinhalaTarget;
  tracks: WatchSubtitle[];
  onPick: (track: WatchSubtitle) => void;
  onAdd: (track: WatchSubtitle) => void;
  onClose: () => void;
  onTranslate: (track: WatchSubtitle) => void;
  initialMode?: "library" | "search";
  message?: string;
}) {
  const [mode, setMode] = useState<"library" | "search" | "upload">(initialMode);
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
        const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]') ?? [])];
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
        if (!res.ok) throw new Error(body.message ?? "Could not search subtitles");
        setCandidates(body.candidates);
      } catch (e) { if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Search failed"); }
      finally { if (!ctrl.signal.aborted) setBusy(false); }
    };
    void search();
    return () => ctrl.abort();
  }, [mode, target, lang]);
  const accept = async (request: () => Promise<Response>) => {
    setBusy(true); setError("");
    try {
      const res = await request();
      const body = await res.json();
      if (!res.ok || !body.track) throw new Error(body.message ?? "Could not load this subtitle");
      onAdd(body.track); onPick(body.track);
    } catch (e) { setError(e instanceof Error ? e.message : "Subtitle request failed"); }
    finally { setBusy(false); }
  };
  const feedback = async (trackId: string, action: "good" | "report", reason?: string) => {
    const res = await fetchWithRefresh("/api/subtitles/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackId, action, reason }) }).catch(() => null);
    setNote(res?.ok ? action === "good" ? "Thanks for your vote" : "Problem reported. Thank you." : "Could not save your feedback. Try again.");
  };
  const invite = async (trackId: string) => {
    try {
      const res = await fetchWithRefresh("/api/subtitles/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Could not create an invitation");
      const link = new URL(window.location.href); link.searchParams.set("subtitleInvite", data.invite);
      await navigator.clipboard.writeText(link.toString());
      setNote("Invitation copied. It expires in 7 days. Three successful viewers can promote this upload.");
    } catch (e) { setNote(e instanceof Error ? e.message : "Could not copy this invitation"); }
  };
  return (
    <div className="v-sub-library-backdrop" onClick={onClose}>
      <div ref={panel} className="v-sub-library" role="dialog" aria-modal="true" aria-label="Subtitle library" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <header className="v-sub-head"><strong>Subtitle library</strong><button ref={first} className="v-bar-icon" aria-label="Close subtitle library" onClick={onClose}><CloseIcon size={18} /></button></header>
        <nav className="v-sub-chips" aria-label="Subtitle options">
          <button className="v-sub-chip" aria-pressed={mode === "library"} onClick={() => setMode("library")}>Stored tracks</button>
          {target && <><button className="v-sub-chip" aria-pressed={mode === "search"} onClick={() => setMode("search")}>Find another subtitle</button><button className="v-sub-chip" aria-pressed={mode === "upload"} onClick={() => setMode("upload")}>Upload my own</button></>}
        </nav>
        {message && <p className="v-sub-note">{message}</p>}
        {(mode === "search" || mode === "upload") && <label className="v-sub-field">Language<select aria-label="Subtitle language" value={lang} onChange={(e) => setLang(e.target.value)}>{[["en", "English"], ["si", "Sinhala"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"], ["it", "Italian"], ["ar", "Arabic"], ["ru", "Russian"], ["hi", "Hindi"]].map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>}
        {busy && <div className="v-sub-library-progress"><PlayerStatus title={mode === "search" ? "Finding subtitles…" : "Preparing subtitle…"} message="You can keep watching while this completes." /></div>}
        {error && <p role="alert">{error}</p>}{note && <p role="status">{note}</p>}
        {mode === "library" && <ul className="v-sub-library-list">{tracks.filter((t) => t.url).map((t) => <li key={t.id}>
          <button className="v-btn v-btn-sm" onClick={() => onPick(t)}>{t.label} · {sourceLabel(t)}{t.visibility === "private" ? " · Private" : ""}</button>
          {libraryId(t.id) && <div className="v-sub-chips">
            {t.language === "en" && <button className="v-sub-chip" onClick={() => onTranslate(t)}>Translate to Sinhala</button>}
            {t.canShare && t.visibility === "private" && <button className="v-sub-chip" onClick={() => void invite(t.id)}>Invite a viewer to try</button>}
            <button className="v-sub-chip" onClick={() => void feedback(t.id, "good")}>Good subtitle</button>
            <details><summary>Subtitle problem?</summary>{[["out_of_sync", "Out of sync"], ["wrong_language", "Wrong language"], ["wrong_movie", "Wrong movie"]].map(([reason, label]) => <button key={reason} className="v-sub-chip" onClick={() => void feedback(t.id, "report", reason)}>{label}</button>)}</details>
          </div>}
        </li>)}{!tracks.some((t) => t.url) && <li>No stored subtitles yet.</li>}</ul>}
        {mode === "search" && !busy && <ul className="v-sub-library-list">{candidates.map((c) => <li key={c.ref}><button className="v-btn" onClick={() => void accept(() => fetchWithRefresh("/api/subtitles/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: c.ref }) }))}>{c.release || c.fileName}<small>{c.downloads} downloads{c.rating !== null ? ` · ${c.rating} rating` : ""}</small></button></li>)}{!candidates.length && <li>No subtitles found. Try another language or upload your own.</li>}</ul>}
        {mode === "upload" && <div className="v-sub-field"><p className="v-sub-note">SRT or VTT, up to 2 MB. Your upload starts private.</p><input aria-label="Upload subtitle file" type="file" accept=".srt,.vtt" disabled={busy} onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file || !target) return;
          if (file.size > 2 * 1024 * 1024) return setError("Subtitle must be at most 2 MB");
          const form = new FormData();
          Object.entries(target).forEach(([k, v]) => { if (v !== undefined) form.set(k, String(v)); });
          form.set("file", file); form.set("language", lang);
          void accept(() => fetchWithRefresh("/api/subtitles/upload", { method: "POST", body: form }));
        }} /></div>}
      </div>
    </div>
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
