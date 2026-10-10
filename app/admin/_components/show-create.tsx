"use client";

import { FormEvent, useState } from "react";
import { adminApi, errorText, tmdbImage } from "@/lib/client/admin";
import { navigate } from "@/lib/client/api";
import { EntityFields, FormValues, SHOW_DEFS, fromForm, toForm } from "./fields";
import { SearchPicker } from "./search-picker";
import { ImagePicker, SeasonImagePicker, selectionFromValues, valuesWithSelection } from "./image-picker";
import { PrefillVideos, defaultPicks, pickedVideos } from "./videos-section";
import { EMPTY_CANDIDATES, type ImageCandidates } from "@/lib/images";
import type { VideoPrefill } from "@/lib/videos";

type Episode = { episodeNumber: number; name: string; isVisible: boolean } & Record<string, unknown>;
type Season = { seasonNumber: number; name: string; isVisible: boolean; episodes: Episode[] } & Record<string, unknown>;

export function ShowCreate() {
  const [tmdbId, setTmdbId] = useState<number | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [videos, setVideos] = useState<VideoPrefill[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [images, setImages] = useState<ImageCandidates>(EMPTY_CANDIDATES);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function select(id: number) {
    setError("");
    setStatus("Loading show, seasons and episodes from TMDB (this can take a moment)...");
    const res = await adminApi<{ show: Record<string, unknown> & { seasons: Season[]; warnings: string[]; videos: VideoPrefill[]; images: ImageCandidates } }>(
      "GET",
      `/api/admin/tmdb/tv/${id}`,
    );
    setStatus("");
    if (!res.ok) return setError(errorText(res));
    setTmdbId(id);
    setValues(toForm(res.show, SHOW_DEFS));
    setSeasons(res.show.seasons);
    setWarnings(res.show.warnings);
    setVideos(res.show.videos ?? []);
    setPicked(defaultPicks(res.show.videos ?? []));
    setImages(res.show.images ?? EMPTY_CANDIDATES);
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
      videos: pickedVideos(videos, picked),
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
                <div className="mt-2 flex flex-wrap items-start gap-4">
                  {tmdbImage(s.posterPath, "w185") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={tmdbImage(s.posterPath, "w185")!} alt={`Season ${s.seasonNumber} poster`} width={92} height={138} loading="lazy" className="w-24 rounded-md" />
                  ) : (
                    <small>No season image</small>
                  )}
                  <div className="min-w-0 flex-1">
                    <SeasonImagePicker
                      tmdbId={tmdbId!}
                      seasonNumber={s.seasonNumber}
                      value={typeof s.posterPath === "string" ? s.posterPath : null}
                      onChange={(p) => setSeason(i, (x) => ({ ...x, posterPath: p }))}
                    />
                  </div>
                </div>
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
          <fieldset>
            <legend>Images</legend>
            <ImagePicker
              candidates={images}
              value={selectionFromValues(values)}
              onChange={(sel) => setValues((v) => valuesWithSelection(v, sel))}
            />
          </fieldset>
          <PrefillVideos videos={videos} picked={picked} onChange={setPicked} />
          <button type="submit">Save show</button>
        </form>
      )}
    </>
  );
}
