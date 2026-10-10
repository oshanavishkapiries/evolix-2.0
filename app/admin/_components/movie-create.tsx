"use client";

import { FormEvent, useState } from "react";
import { adminApi, errorText, tmdbImage } from "@/lib/client/admin";
import { navigate } from "@/lib/client/api";
import { EntityFields, FormValues, MOVIE_DEFS, fromForm, toForm, withoutImages } from "./fields";
import { ImagePicker, selectionFromValues, valuesWithSelection } from "./image-picker";
import { SearchPicker } from "./search-picker";
import { Switch } from "./switch";
import { useToast } from "./toast";
import { PrefillVideos, defaultPicks, pickedVideos } from "./videos-section";
import { StepIndicator, WizardBar } from "./wizard-steps";
import { EMPTY_CANDIDATES, type ImageCandidates } from "@/lib/images";
import type { VideoPrefill } from "@/lib/videos";

export function MovieCreate() {
  const toast = useToast();
  const [tmdbId, setTmdbId] = useState<number | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [videos, setVideos] = useState<VideoPrefill[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [images, setImages] = useState<ImageCandidates>(EMPTY_CANDIDATES);
  const [published, setPublished] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const step = saving ? 3 : tmdbId === null ? 1 : 2;
  const detailDefs = withoutImages(MOVIE_DEFS);

  async function select(id: number) {
    setLoading(true);
    const res = await adminApi<{ movie: Record<string, unknown> & { videos: VideoPrefill[]; images: ImageCandidates } }>("GET", `/api/admin/tmdb/movie/${id}`);
    setLoading(false);
    if (!res.ok) return toast.error(errorText(res));
    setTmdbId(id);
    setValues(toForm(res.movie, MOVIE_DEFS));
    setVideos(res.movie.videos ?? []);
    setPicked(defaultPicks(res.movie.videos ?? []));
    setImages(res.movie.images ?? EMPTY_CANDIDATES);
    setPublished(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = fromForm(values, MOVIE_DEFS);
    if ("error" in parsed) return toast.error(parsed.error);
    setSaving(true);
    const res = await adminApi<{ movie: { id: string } }>("POST", "/api/admin/movies", {
      ...parsed.data,
      tmdbId,
      isPublished: published,
      videos: pickedVideos(videos, picked),
    });
    if (!res.ok) {
      setSaving(false);
      return toast.error(errorText(res));
    }
    navigate(`/admin/movies/${res.movie.id}`);
  }

  return (
    <div className="space-y-6">
      <StepIndicator current={step} />
      <div hidden={tmdbId !== null}>
        <SearchPicker type="movie" onSelect={select} busy={loading} />
        {loading && (
          <p className="mt-3 flex items-center gap-2 text-sm" role="status">
            <span className="spinner" aria-hidden="true" /> Loading details from TMDB...
          </p>
        )}
      </div>
      {tmdbId !== null && (
        <form onSubmit={onSubmit} aria-label="Review movie" className="space-y-6">
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
          <PrefillVideos videos={videos} picked={picked} onChange={setPicked} />
          <WizardBar saving={saving} saveLabel="Save movie" onBack={() => setTmdbId(null)} />
        </form>
      )}
    </div>
  );
}
