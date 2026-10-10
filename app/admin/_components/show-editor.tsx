"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { adminApi, errorText, tmdbImage } from "@/lib/client/admin";
import { navigate } from "@/lib/client/api";
import {
  EPISODE_DEFS,
  EntityFields,
  FieldDef,
  FormValues,
  SEASON_DEFS,
  SHOW_DEFS,
  fromForm,
  toForm,
} from "./fields";
import { ChooseImages, SeasonImagePicker } from "./image-picker";
import { PageHeader } from "./page-header";
import { MediaManager } from "./items-section";
import { VideosSection } from "./videos-section";

type Rec = Record<string, unknown> & { id: string; isVisible?: boolean };
type Season = Rec & { seasonNumber: number; name: string; episodes: Rec[] };
type Show = Rec & { name: string; isPublished: boolean; tmdbId: number };

/** One season or episode: instant visibility toggle plus an editable form. */
function NodeEditor({
  endpoint,
  record,
  defs,
  label,
  onDeleted,
  imagePicker,
  children,
}: {
  endpoint: string;
  record: Rec;
  defs: FieldDef[];
  label: string;
  onDeleted: () => void;
  /** Season rows: tmdb ids needed to load image candidates. */
  imagePicker?: { showTmdbId: number; seasonNumber: number };
  children?: React.ReactNode;
}) {
  const [values, setValues] = useState<FormValues>(() => toForm(record, defs));
  const [visible, setVisible] = useState(record.isVisible === true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function save(body: unknown, done: string) {
    setError("");
    setStatus("");
    const res = await adminApi("PATCH", `${endpoint}/${record.id}`, body);
    if (!res.ok) {
      setError(errorText(res));
      return false;
    }
    setStatus(done);
    return true;
  }

  const poster = values.posterPath ? String(values.posterPath) : null;
  const [savedPoster, setSavedPoster] = useState(poster);

  async function savePoster(path: string | null) {
    const ok = await save({ posterPath: path }, path ? "Season image saved." : "Season image cleared.");
    if (ok) setSavedPoster(path);
    return ok;
  }

  async function toggle(next: boolean) {
    if (await save({ isVisible: next }, next ? "Visible." : "Hidden.")) setVisible(next);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = fromForm(values, defs);
    if ("error" in parsed) return setError(parsed.error);
    void save(parsed.data, "Saved.");
  }

  async function remove() {
    if (!window.confirm(`Delete ${label} and everything under it?`)) return;
    const res = await adminApi("DELETE", `${endpoint}/${record.id}`);
    if (!res.ok) return setError(errorText(res));
    onDeleted();
  }

  return (
    <details className="bg-white dark:bg-gray-900">
      <summary>
        {imagePicker && tmdbImage(savedPoster, "w92") && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tmdbImage(savedPoster, "w92")!} alt="" width={32} height={48} loading="lazy" className="mr-2 inline-block h-12 w-8 rounded object-cover align-middle" />
        )}
        {label} - {visible ? "visible" : "hidden"}
      </summary>
      <p className="toolbar">
        <label>
          Visible{" "}
          <input type="checkbox" checked={visible} onChange={(e) => toggle(e.target.checked)} />
        </label>{" "}
        <button type="button" className="btn-danger" onClick={remove}>
          Delete
        </button>
      </p>
      {imagePicker && (
        <div className="mt-4 flex flex-wrap items-start gap-4">
          {tmdbImage(poster, "w185") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tmdbImage(poster, "w185")!} alt={`${label} poster`} width={92} height={138} loading="lazy" className="w-24 rounded-md" />
          ) : (
            <small>No season image</small>
          )}
          <div className="min-w-0 flex-1">
            <SeasonImagePicker
              tmdbId={imagePicker.showTmdbId}
              seasonNumber={imagePicker.seasonNumber}
              value={poster}
              onChange={(p) => setValues((v) => ({ ...v, posterPath: p ?? "" }))}
              onSave={savePoster}
            />
          </div>
        </div>
      )}
      <form onSubmit={onSubmit}>
        <fieldset>
          <legend>Edit {label}</legend>
          <EntityFields defs={defs} values={values} onChange={setValues} />
          <button type="submit">Save</button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {children}
    </details>
  );
}

export function ShowEditor({ id }: { id: string }) {
  const [show, setShow] = useState<(Show & { seasons: Season[] }) | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const res = await adminApi<{ show: Show & { seasons: Season[] } }>("GET", `/api/admin/shows/${id}`);
    if (!res.ok) return setError(errorText(res));
    setShow(res.show);
    setValues(toForm(res.show, SHOW_DEFS));
  }, [id]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function patch(body: unknown, done: string) {
    setError("");
    setStatus("");
    const res = await adminApi<{ show: Show }>("PATCH", `/api/admin/shows/${id}`, body);
    if (!res.ok) {
      setError(errorText(res));
      return false;
    }
    setShow((s) => (s ? { ...s, ...res.show } : s));
    setStatus(done);
    return true;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = fromForm(values, SHOW_DEFS);
    if ("error" in parsed) return setError(parsed.error);
    void patch(parsed.data, "Saved.");
  }

  async function remove() {
    if (!window.confirm("Delete this show with all seasons, episodes, sources, subtitles and videos?")) return;
    const res = await adminApi("DELETE", `/api/admin/shows/${id}`);
    if (!res.ok) return setError(errorText(res));
    navigate("/admin/shows");
  }

  if (!show) return error ? <p role="alert">{error}</p> : <p>Loading...</p>;

  return (
    <>
      <PageHeader
        title={show.name}
        actions={
          <>
            <span>
              State:{" "}
              <span className={`badge ${show.isPublished ? "badge-on" : "badge-off"}`}>{show.isPublished ? "published" : "draft"}</span>
            </span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => patch({ isPublished: !show.isPublished }, show.isPublished ? "Unpublished." : "Published.")}
            >
              {show.isPublished ? "Unpublish" : "Publish"}
            </button>
            <button type="button" className="btn-danger" onClick={remove}>
              Delete show
            </button>
          </>
        }
      />
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      <form onSubmit={onSubmit}>
        <fieldset>
          <legend>Show details (TMDB {show.tmdbId})</legend>
          {tmdbImage(show.posterPath) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tmdbImage(show.posterPath)!} alt="Poster" width={150} className="mb-4 w-36 rounded-md" />
          )}
          <EntityFields defs={SHOW_DEFS} values={values} onChange={setValues} />
          <button type="submit">Save changes</button>
        </fieldset>
      </form>
      <ChooseImages
        kind="tv"
        tmdbId={show.tmdbId}
        values={values}
        onValues={setValues}
        onSave={async (sel) => patch(sel, "Images saved.")}
      />
      <VideosSection parent={{ showId: id }} />
      <section>
        <h2>Seasons</h2>
        {show.seasons.length === 0 && <p>No seasons.</p>}
        {show.seasons.map((s) => (
          <NodeEditor
            key={s.id}
            endpoint="/api/admin/seasons"
            record={s}
            defs={SEASON_DEFS}
            imagePicker={{ showTmdbId: show.tmdbId, seasonNumber: s.seasonNumber }}
            label={`Season ${s.seasonNumber}${s.name ? `: ${s.name}` : ""}`}
            onDeleted={load}
          >
            <h3>Episodes</h3>
            {s.episodes.length === 0 && <p>No episodes.</p>}
            {s.episodes.map((ep) => (
              <NodeEditor
                key={ep.id}
                endpoint="/api/admin/episodes"
                record={ep}
                defs={EPISODE_DEFS}
                label={`Episode ${ep.episodeNumber}${ep.name ? `: ${ep.name}` : ""}`}
                onDeleted={load}
              >
                <details>
                  <summary>Sources and subtitles</summary>
                  <MediaManager parent={{ episodeId: ep.id }} />
                </details>
              </NodeEditor>
            ))}
          </NodeEditor>
        ))}
      </section>
    </>
  );
}
