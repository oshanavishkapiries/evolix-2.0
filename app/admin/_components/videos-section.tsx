"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AdminVideo,
  VideoParent,
  createVideo,
  deleteVideo,
  errorText,
  importTmdbVideos,
  listVideos,
  updateVideo,
} from "@/lib/client/admin";
import {
  TYPE_LABELS,
  VIDEO_SITES,
  VIDEO_TYPES,
  VideoPrefill,
  VideoSite,
  VideoType,
  isValidKey,
  parseVideoUrl,
  videoWatchUrl,
} from "@/lib/videos";

type Meta = Pick<AdminVideo, "site" | "key" | "name" | "type" | "official" | "language">;

function VideoSummary({ v, hidden }: { v: Meta; hidden?: boolean }) {
  return (
    <span className="min-w-0 text-sm">
      <strong className="break-words">{v.name}</strong>{" "}
      <span className="badge badge-off">{TYPE_LABELS[v.type]}</span>{" "}
      {v.official && <span className="badge badge-on">official</span>}{" "}
      {hidden && <span className="badge badge-off">hidden</span>}{" "}
      <span>
        {v.site}
        {v.language ? `, ${v.language}` : ""}
      </span>{" "}
      <a href={videoWatchUrl(v.site, v.key)} target="_blank" rel="noopener noreferrer">
        Open<span className="sr-only"> {v.name} on {v.site} (new tab)</span>
      </a>
    </span>
  );
}

/** New-flow list: TMDB videos that will be saved with the title; rows can be removed. */
export function PrefillVideos({
  videos,
  onChange,
}: {
  videos: VideoPrefill[];
  onChange: (next: VideoPrefill[]) => void;
}) {
  return (
    <fieldset>
      <legend>Videos ({videos.length})</legend>
      {videos.length === 0 ? (
        <p>No YouTube or Vimeo videos found on TMDB.</p>
      ) : (
        <ul className="rows">
          {videos.map((v) => (
            <li key={`${v.site}:${v.key}`}>
              <VideoSummary v={v} />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onChange(videos.filter((x) => x !== v))}
              >
                Remove<span className="sr-only"> {v.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

type Form = {
  input: string;
  site: VideoSite;
  name: string;
  type: VideoType;
  official: boolean;
  language: string;
  isVisible: boolean;
};
const EMPTY: Form = { input: "", site: "youtube", name: "", type: "trailer", official: false, language: "", isVisible: true };

/** Videos management (list, reorder, add, edit, delete, TMDB import) for a movie or a show. */
export function VideosSection({ parent }: { parent: VideoParent }) {
  const parentKey = JSON.stringify(parent);
  const [items, setItems] = useState<AdminVideo[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await listVideos(JSON.parse(parentKey));
    if (res.ok) setItems(res.videos);
    else setError(errorText(res));
  }, [parentKey]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  function reset() {
    setEditing(null);
    setForm(EMPTY);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setStatus("");
    const language = form.language.trim().toLowerCase();
    const common = {
      name: form.name.trim(),
      type: form.type,
      official: form.official,
      language: language || null,
      isVisible: form.isVisible,
    };
    if (!common.name) return setError("Name is required");

    let target: { site: VideoSite; key: string } | null = null;
    const raw = form.input.trim();
    if (!editing || raw) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) target = parseVideoUrl(raw);
      else if (isValidKey(form.site, raw)) target = { site: form.site, key: raw };
      if (!target) {
        return setError("Enter a YouTube or Vimeo URL (watch, youtu.be, embed, vimeo.com) or a valid video key for the selected site");
      }
    }

    setBusy(true);
    const res = editing
      ? await updateVideo(editing, { ...common, ...target })
      : await createVideo(parent, { ...common, ...target! });
    setBusy(false);
    if (!res.ok) {
      return setError(res.status === 409 ? "This video is already in the list" : errorText(res));
    }
    reset();
    await load();
  }

  function startEdit(v: AdminVideo) {
    setEditing(v.id);
    setForm({
      input: "",
      site: v.site,
      name: v.name,
      type: v.type,
      official: v.official,
      language: v.language ?? "",
      isVisible: v.isVisible,
    });
  }

  async function remove(v: AdminVideo) {
    if (!window.confirm(`Delete the video "${v.name}"?`)) return;
    const res = await deleteVideo(v.id);
    if (!res.ok) return setError(errorText(res));
    if (editing === v.id) reset();
    await load();
  }

  async function move(index: number, dir: -1 | 1) {
    if (!items) return;
    const other = index + dir;
    if (other < 0 || other >= items.length) return;
    setError("");
    setStatus("");
    const next = [...items];
    [next[index], next[other]] = [next[other], next[index]];
    // Renumber by position so equal or gapped sort orders still swap correctly.
    setBusy(true);
    const changed = next.map((v, i) => ({ v, i })).filter(({ v, i }) => v.sortOrder !== i);
    const results = await Promise.all(changed.map(({ v, i }) => updateVideo(v.id, { sortOrder: i })));
    setBusy(false);
    const failed = results.find((r) => !r.ok);
    if (failed) setError(errorText(failed));
    await load();
  }

  async function importFromTmdb() {
    setError("");
    setStatus("");
    setBusy(true);
    const res = await importTmdbVideos(parent);
    setBusy(false);
    if (!res.ok) return setError(errorText(res));
    setStatus(`Added ${res.added}, skipped ${res.skipped}`);
    await load();
  }

  return (
    <section className="card">
      <h3>Videos</h3>
      <p className="toolbar">
        <button type="button" className="btn-secondary" onClick={importFromTmdb} disabled={busy}>
          Load videos from TMDB
        </button>
      </p>
      <p role="status">{status}</p>
      {items === null ? (
        <p>Loading...</p>
      ) : items.length === 0 ? (
        <p>None yet.</p>
      ) : (
        <ul className="rows">
          {items.map((v, i) => (
            <li key={v.id}>
              <VideoSummary v={v} hidden={!v.isVisible} />
              <span className="toolbar">
                <button type="button" className="btn-secondary" disabled={busy || i === 0} onClick={() => move(i, -1)}>
                  Up<span className="sr-only"> {v.name}</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy || i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  Down<span className="sr-only"> {v.name}</span>
                </button>
                <button type="button" className="btn-secondary" onClick={() => startEdit(v)}>
                  Edit<span className="sr-only"> {v.name}</span>
                </button>
                <button type="button" className="btn-danger" onClick={() => remove(v)}>
                  Delete<span className="sr-only"> {v.name}</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit}>
        <fieldset>
          <legend>{editing ? "Edit video" : "Add video"}</legend>
          <div className="fields">
            <p className="wide">
              <label>
                {editing ? "Replace URL or key (optional)" : "YouTube/Vimeo URL or video key"}{" "}
                <input type="text" value={form.input} onChange={(e) => set("input", e.target.value)} />
              </label>
            </p>
            <p>
              <label>
                Site (used when a key is entered){" "}
                <select value={form.site} onChange={(e) => set("site", e.target.value as VideoSite)}>
                  {VIDEO_SITES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </p>
            <p>
              <label>
                Name <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} />
              </label>
            </p>
            <p>
              <label>
                Type{" "}
                <select value={form.type} onChange={(e) => set("type", e.target.value as VideoType)}>
                  {VIDEO_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
            </p>
            <p>
              <label>
                Language (e.g. en){" "}
                <input type="text" value={form.language} onChange={(e) => set("language", e.target.value)} />
              </label>
            </p>
            <p>
              <label>
                Official{" "}
                <input type="checkbox" checked={form.official} onChange={(e) => set("official", e.target.checked)} />
              </label>
            </p>
            <p>
              <label>
                Visible{" "}
                <input type="checkbox" checked={form.isVisible} onChange={(e) => set("isVisible", e.target.checked)} />
              </label>
            </p>
          </div>
          <button type="submit" disabled={busy}>
            {editing ? "Save changes" : "Add"}
          </button>
          {editing && (
            <>
              {" "}
              <button type="button" className="btn-secondary" onClick={reset}>
                Cancel edit
              </button>
            </>
          )}
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
