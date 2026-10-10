"use client";

import { FormEvent, useState } from "react";
import { adminApi, errorText, tmdbImage } from "@/lib/client/admin";
import { navigate } from "@/lib/client/api";
import { EntityFields, FormValues, MOVIE_DEFS, fromForm, toForm } from "./fields";
import { SearchPicker } from "./search-picker";

export function MovieCreate() {
  const [tmdbId, setTmdbId] = useState<number | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [published, setPublished] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function select(id: number) {
    setError("");
    setStatus("Loading details from TMDB...");
    const res = await adminApi<{ movie: Record<string, unknown> }>("GET", `/api/admin/tmdb/movie/${id}`);
    setStatus("");
    if (!res.ok) return setError(errorText(res));
    setTmdbId(id);
    setValues(toForm(res.movie, MOVIE_DEFS));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = fromForm(values, MOVIE_DEFS);
    if ("error" in parsed) return setError(parsed.error);
    setError("");
    setStatus("Saving...");
    const res = await adminApi<{ movie: { id: string } }>("POST", "/api/admin/movies", {
      ...parsed.data,
      tmdbId,
      isPublished: published,
    });
    if (!res.ok) {
      setStatus("");
      return setError(errorText(res));
    }
    navigate(`/admin/movies/${res.movie.id}`);
  }

  return (
    <>
      <SearchPicker type="movie" onSelect={select} />
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {tmdbId !== null && (
        <form onSubmit={onSubmit}>
          <fieldset>
            <legend>Movie details (TMDB {tmdbId})</legend>
            {tmdbImage(values.posterPath) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tmdbImage(values.posterPath)!} alt="Poster" width={150} className="mb-4 w-36 rounded-md" />
            )}
            <EntityFields defs={MOVIE_DEFS} values={values} onChange={setValues} />
            <p>
              <label>
                Published{" "}
                <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
              </label>
            </p>
            <button type="submit">Save movie</button>
          </fieldset>
        </form>
      )}
    </>
  );
}
