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
  children,
}: {
  endpoint: string;
  record: Rec;
  defs: FieldDef[];
  label: string;
  onDeleted: () => void;
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
    if (!res.ok) return setError(errorText(res));
    setShow((s) => (s ? { ...s, ...res.show } : s));
    setStatus(done);
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
    navigate("/admin");
  }

  if (!show) return error ? <p role="alert">{error}</p> : <p>Loading...</p>;

  return (
    <>
      <h1>{show.name}</h1>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      <p className="toolbar">
        State:{" "}
        <span className={`badge ${show.isPublished ? "badge-on" : "badge-off"}`}>{show.isPublished ? "published" : "draft"}</span>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => patch({ isPublished: !show.isPublished }, show.isPublished ? "Unpublished." : "Published.")}
        >
          {show.isPublished ? "Unpublish" : "Publish"}
        </button>{" "}
        <button type="button" className="btn-danger" onClick={remove}>
          Delete show
        </button>
      </p>
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
