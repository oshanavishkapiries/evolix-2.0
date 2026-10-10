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
import { useConfirm } from "./confirm-dialog";
import { Switch } from "./switch";
import { useToast } from "./toast";
import {
  TYPE_LABELS,
  VIDEO_SITES,
  VIDEO_TYPES,
  VideoPrefill,
  VideoSite,
  VideoType,
  isValidKey,
  parseVideoUrl,
  rankVideos,
  videoWatchUrl,
} from "@/lib/videos";

type Meta = Pick<AdminVideo, "site" | "key" | "name" | "type" | "official" | "language">;

function WatchLink({ v }: { v: Meta }) {
  return (
    <>
      {" "}
      <a href={videoWatchUrl(v.site, v.key)} target="_blank" rel="noopener noreferrer">
        Open<span className="sr-only"> {v.name} on {v.site} (new tab)</span>
      </a>
    </>
  );
}

function VideoSummary({ v, hidden, link = true }: { v: Meta; hidden?: boolean; link?: boolean }) {
  return (
    <span className="min-w-0 text-sm">
      <strong className="break-words">{v.name}</strong>{" "}
      <span className="badge badge-off">{TYPE_LABELS[v.type]}</span>{" "}
      {v.official && <span className="badge badge-on">official</span>}{" "}
      {hidden && <span className="badge badge-off">hidden</span>}{" "}
      <span>
        {v.site}
        {v.language ? `, ${v.language}` : ""}
      </span>
      {link && <WatchLink v={v} />}
    </span>
  );
}

export const videoId = (v: { site: string; key: string }) => `${v.site}:${v.key}`;

/** Ids of the default selection (top 5 by rank). */
export const defaultPicks = (videos: VideoPrefill[]) => new Set(rankVideos(videos).map(videoId));

/** Videos to save: only the checked ones, best first, renumbered. */
export const pickedVideos = (videos: VideoPrefill[], picked: Set<string>) =>
  videos
    .filter((v) => picked.has(videoId(v)))
    .map((v, i) => ({ ...v, sortOrder: i }));

/** New-flow list: every TMDB video with a checkbox; only checked ones are saved. */
export function PrefillVideos({
  videos,
  picked,
  onChange,
}: {
  videos: VideoPrefill[];
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };
  return (
    <fieldset>
      <legend>Videos ({videos.length} found)</legend>
      {videos.length === 0 ? (
        <p>No YouTube or Vimeo videos found on TMDB.</p>
      ) : (
        <>
          <p className="toolbar">
            <span aria-live="polite">
              <strong>{picked.size} selected</strong>
            </span>
            <button type="button" className="btn-secondary" onClick={() => onChange(defaultPicks(videos))}>
              Select top 5
            </button>
            <button type="button" className="btn-secondary" onClick={() => onChange(new Set())}>
              Clear selection
            </button>
          </p>
          <ul className="rows">
            {videos.map((v) => {
              const id = videoId(v);
              return (
                <li key={id}>
                  <label className="min-w-0">
                    <input type="checkbox" checked={picked.has(id)} onChange={(e) => toggle(id, e.target.checked)} />
                    <VideoSummary v={v} link={false} />
                  </label>
                  <WatchLink v={v} />
                </li>
              );
            })}
          </ul>
        </>
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
  const confirm = useConfirm();
  const toast = useToast();
  const parentKey = JSON.stringify(parent);
  const [items, setItems] = useState<AdminVideo[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState("");
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
    if (!(await confirm({ title: "Delete video?", body: `"${v.name}" will be removed from the list.` }))) return;
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
    setBusy(true);
    const res = await importTmdbVideos(parent);
    setBusy(false);
    if (!res.ok) return setError(errorText(res));
    toast.success(`Added ${res.added}, skipped ${res.skipped}`);
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
      {items === null ? (
        <div className="space-y-2" aria-busy="true">
          <div className="skeleton h-12" />
          <div className="skeleton h-12" />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 p-4 text-center text-sm dark:border-gray-700">
          No videos yet - load from TMDB or add one below.
        </p>
      ) : (
        <ul className="rows">
          {items.map((v, i) => (
            <li key={v.id}>
              <VideoSummary v={v} hidden={!v.isVisible} />
              <span className="toolbar">
                <Switch
                  checked={v.isVisible}
                  label={`Visible: ${v.name}`}
                  onLabel="Visible"
                  offLabel="Hidden"
                  onToggle={async (next) => {
                    const res = await updateVideo(v.id, { isVisible: next });
                    if (!res.ok) {
                      setError(errorText(res));
                      return false;
                    }
                    setItems((all) => all?.map((x) => (x.id === v.id ? { ...x, isVisible: next } : x)) ?? all);
                    return true;
                  }}
                />
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
