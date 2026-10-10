"use client";

import { FormEvent, useEffect, useState } from "react";
import { adminApi, errorText, tmdbImage } from "@/lib/client/admin";
import { navigate } from "@/lib/client/api";
import { EntityFields, FormValues, MOVIE_DEFS, fromForm, toForm } from "./fields";
import { MediaManager } from "./items-section";

export function MovieEditor({ id }: { id: string }) {
  const [movie, setMovie] = useState<Record<string, unknown> | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  function apply(m: Record<string, unknown>) {
    setMovie(m);
    setValues(toForm(m, MOVIE_DEFS));
  }

  useEffect(() => {
    (async () => {
      const res = await adminApi<{ movie: Record<string, unknown> }>("GET", `/api/admin/movies/${id}`);
      if (res.ok) apply(res.movie);
      else setError(errorText(res));
    })();
  }, [id]);

  async function patch(body: unknown, done: string) {
    setError("");
    setStatus("");
    const res = await adminApi<{ movie: Record<string, unknown> }>("PATCH", `/api/admin/movies/${id}`, body);
    if (!res.ok) return setError(errorText(res));
    apply(res.movie);
    setStatus(done);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = fromForm(values, MOVIE_DEFS);
    if ("error" in parsed) return setError(parsed.error);
    void patch(parsed.data, "Saved.");
  }

  async function remove() {
    if (!window.confirm("Delete this movie and all its sources and subtitles?")) return;
    const res = await adminApi("DELETE", `/api/admin/movies/${id}`);
    if (!res.ok) return setError(errorText(res));
    navigate("/admin");
  }

  if (!movie) return error ? <p role="alert">{error}</p> : <p>Loading...</p>;
  const published = movie.isPublished === true;

  return (
    <>
      <h1>{String(movie.title)}</h1>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      <p className="toolbar">
        State:{" "}
        <span className={`badge ${published ? "badge-on" : "badge-off"}`}>{published ? "published" : "draft"}</span>
        <button type="button" className="btn-secondary" onClick={() => patch({ isPublished: !published }, published ? "Unpublished." : "Published.")}>
          {published ? "Unpublish" : "Publish"}
        </button>{" "}
        <button type="button" className="btn-danger" onClick={remove}>
          Delete movie
        </button>
      </p>
      <form onSubmit={onSubmit}>
        <fieldset>
          <legend>Movie details (TMDB {String(movie.tmdbId)})</legend>
          {tmdbImage(movie.posterPath) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tmdbImage(movie.posterPath)!} alt="Poster" width={150} className="mb-4 w-36 rounded-md" />
          )}
          <EntityFields defs={MOVIE_DEFS} values={values} onChange={setValues} />
          <button type="submit">Save changes</button>
        </fieldset>
      </form>
      <MediaManager parent={{ movieId: id }} />
    </>
  );
}
