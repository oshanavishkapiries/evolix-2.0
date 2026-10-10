"use client";

import { FormEvent, useState } from "react";
import { adminApi, errorText, tmdbImage } from "@/lib/client/admin";
import { navigate } from "@/lib/client/api";
import { EntityFields, FormValues, SHOW_DEFS, fromForm, toForm, withoutImages } from "./fields";
import { ImagePicker, SeasonImagePicker, selectionFromValues, valuesWithSelection } from "./image-picker";
import { SearchPicker } from "./search-picker";
import { Switch } from "./switch";
import { useToast } from "./toast";
import { PrefillVideos, defaultPicks, pickedVideos } from "./videos-section";
import { StepIndicator, WizardBar } from "./wizard-steps";
import { EMPTY_CANDIDATES, type ImageCandidates } from "@/lib/images";
import type { VideoPrefill } from "@/lib/videos";

type Episode = { episodeNumber: number; name: string; isVisible: boolean } & Record<string, unknown>;
type Season = { seasonNumber: number; name: string; isVisible: boolean; episodes: Episode[] } & Record<string, unknown>;

export function ShowCreate() {
  const toast = useToast();
  const [tmdbId, setTmdbId] = useState<number | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [videos, setVideos] = useState<VideoPrefill[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [images, setImages] = useState<ImageCandidates>(EMPTY_CANDIDATES);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [published, setPublished] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const step = saving ? 3 : tmdbId === null ? 1 : 2;
  const detailDefs = withoutImages(SHOW_DEFS);

  async function select(id: number) {
    setLoading(true);
    const res = await adminApi<{ show: Record<string, unknown> & { seasons: Season[]; warnings: string[]; videos: VideoPrefill[]; images: ImageCandidates } }>(
      "GET",
      `/api/admin/tmdb/tv/${id}`,
    );
    setLoading(false);
    if (!res.ok) return toast.error(errorText(res));
    setTmdbId(id);
    setValues(toForm(res.show, SHOW_DEFS));
    setSeasons(res.show.seasons);
    setWarnings(res.show.warnings);
    setVideos(res.show.videos ?? []);
    setPicked(defaultPicks(res.show.videos ?? []));
    setImages(res.show.images ?? EMPTY_CANDIDATES);
    setPublished(false);
  }

  const setSeason = (i: number, fn: (s: Season) => Season) => setSeasons((all) => all.map((s, idx) => (idx === i ? fn(s) : s)));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = fromForm(values, SHOW_DEFS);
    if ("error" in parsed) return toast.error(parsed.error);
    setSaving(true);
    const res = await adminApi<{ id: string }>("POST", "/api/admin/shows", {
      ...parsed.data,
      tmdbId,
      isPublished: published,
      seasons,
      videos: pickedVideos(videos, picked),
    });
    if (!res.ok) {
      setSaving(false);
      return toast.error(errorText(res));
    }
    navigate(`/admin/shows/${res.id}`);
  }

  return (
    <div className="space-y-6">
      <StepIndicator current={step} />
      <div hidden={tmdbId !== null}>
        <SearchPicker type="tv" onSelect={select} busy={loading} />
        {loading && (
          <p className="mt-3 flex items-center gap-2 text-sm" role="status">
            <span className="spinner" aria-hidden="true" /> Loading show, seasons and episodes from TMDB (this can take a moment)...
          </p>
        )}
      </div>
      {tmdbId !== null && (
        <form onSubmit={onSubmit} aria-label="Review show" className="space-y-6">
          <section className="card space-y-4">
            <h2 className="text-base">Details (TMDB {tmdbId})</h2>
            <div className="flex flex-wrap items-start gap-4">
              {tmdbImage(values.posterPath) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tmdbImage(values.posterPath)!} alt="Poster" width={150} className="w-28 rounded-md" />
              )}
              <div className="min-w-0 flex-1">
                <Switch
                  checked={published}
                  label="Publish immediately"
                  onLabel="Publish immediately"
                  offLabel="Save as draft"
                  onToggle={async (n) => {
                    setPublished(n);
                    return true;
                  }}
                />
              </div>
            </div>
            <EntityFields defs={detailDefs} values={values} onChange={setValues} />
          </section>
          <section className="card space-y-3">
            <h2 className="text-base">Images</h2>
            <ImagePicker candidates={images} value={selectionFromValues(values)} onChange={(sel) => setValues((v) => valuesWithSelection(v, sel))} />
          </section>
          <section className="card space-y-3">
            <h2 className="text-base">Seasons and episodes</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">Untick a season or an episode to import it hidden.</p>
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
                    <input type="checkbox" checked={s.isVisible} onChange={(e) => setSeason(i, (x) => ({ ...x, isVisible: e.target.checked }))} />
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
                      tmdbId={tmdbId}
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
                        />
                        E{ep.episodeNumber}: {ep.name}
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </section>
          <PrefillVideos videos={videos} picked={picked} onChange={setPicked} />
          <WizardBar saving={saving} saveLabel="Save show" onBack={() => setTmdbId(null)} />
        </form>
      )}
    </div>
  );
}
