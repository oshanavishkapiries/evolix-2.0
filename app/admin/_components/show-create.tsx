"use client";

import { FormEvent, useState } from "react";
import { adminApi, errorText, tmdbImage } from "@/lib/client/admin";
import { navigate } from "@/lib/client/api";
import { EntityFields, FormValues, SHOW_DEFS, fromForm, toForm } from "./fields";
import { SearchPicker } from "./search-picker";

type Episode = { episodeNumber: number; name: string; isVisible: boolean } & Record<string, unknown>;
type Season = { seasonNumber: number; name: string; isVisible: boolean; episodes: Episode[] } & Record<string, unknown>;

export function ShowCreate() {
  const [tmdbId, setTmdbId] = useState<number | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function select(id: number) {
    setError("");
    setStatus("Loading show, seasons and episodes from TMDB (this can take a moment)...");
    const res = await adminApi<{ show: Record<string, unknown> & { seasons: Season[]; warnings: string[] } }>(
      "GET",
      `/api/admin/tmdb/tv/${id}`,
    );
    setStatus("");
    if (!res.ok) return setError(errorText(res));
    setTmdbId(id);
    setValues(toForm(res.show, SHOW_DEFS));
    setSeasons(res.show.seasons);
    setWarnings(res.show.warnings);
  }

  const setSeason = (i: number, fn: (s: Season) => Season) =>
    setSeasons((all) => all.map((s, idx) => (idx === i ? fn(s) : s)));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = fromForm(values, SHOW_DEFS);
    if ("error" in parsed) return setError(parsed.error);
    setError("");
    setStatus("Saving...");
    const res = await adminApi<{ id: string }>("POST", "/api/admin/shows", {
      ...parsed.data,
      tmdbId,
      isPublished: published,
      seasons,
    });
    if (!res.ok) {
      setStatus("");
      return setError(errorText(res));
    }
    navigate(`/admin/shows/${res.id}`);
  }

  return (
    <>
      <SearchPicker type="tv" onSelect={select} />
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {tmdbId !== null && (
        <form onSubmit={onSubmit}>
          <fieldset>
            <legend>Show details (TMDB {tmdbId})</legend>
            {tmdbImage(values.posterPath) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tmdbImage(values.posterPath)!} alt="Poster" width={150} className="mb-4 w-36 rounded-md" />
            )}
            <EntityFields defs={SHOW_DEFS} values={values} onChange={setValues} />
            <p>
              <label>
                Published{" "}
                <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
              </label>
            </p>
          </fieldset>
          <fieldset>
            <legend>Seasons and episodes (uncheck to hide)</legend>
            {warnings.map((w) => (
              <p role="alert" key={w}>
                {w}
              </p>
            ))}
            {seasons.length === 0 && <p>No seasons.</p>}
            {seasons.map((s, i) => (
              <details key={s.seasonNumber}>
                <summary>
                  <label>
                    <input
                      type="checkbox"
                      checked={s.isVisible}
                      onChange={(e) => setSeason(i, (x) => ({ ...x, isVisible: e.target.checked }))}
                    />{" "}
                    Season {s.seasonNumber}: {s.name} ({s.episodes.length} episodes)
                  </label>
                </summary>
                <ul className="mt-2 space-y-1 pl-6">
                  {s.episodes.map((ep, j) => (
                    <li key={ep.episodeNumber}>
                      <label>
                        <input
                          type="checkbox"
                          checked={ep.isVisible}
                          onChange={(e) =>
                            setSeason(i, (x) => ({
                              ...x,
                              episodes: x.episodes.map((y, k) => (k === j ? { ...y, isVisible: e.target.checked } : y)),
                            }))
                          }
                        />{" "}
                        E{ep.episodeNumber}: {ep.name}
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </fieldset>
          <button type="submit">Save show</button>
        </form>
      )}
    </>
  );
}
