"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { adminApi, errorText, tmdbImage } from "@/lib/client/admin";
import { navigate } from "@/lib/client/api";
import { useConfirm } from "./confirm-dialog";
import { useEntity } from "./entity-shell";
import { EntityFields, MOVIE_DEFS, SHOW_DEFS, fromForm, onlyImages, toForm, withoutImages } from "./fields";
import { SaveBar, useDirtyForm } from "./form-kit";
import { ChooseImages, selectionFromValues } from "./image-picker";
import { SourcesSection, SubtitlesSection } from "./items-section";
import { Switch } from "./switch";
import { useToast } from "./toast";
import { VideosSection } from "./videos-section";

/** Details tab: all text fields of the movie or show in one form. */
export function DetailsPage() {
  const { kind, entity, patch } = useEntity();
  const toast = useToast();
  const defs = withoutImages(kind === "movie" ? MOVIE_DEFS : SHOW_DEFS);
  const form = useDirtyForm(toForm(entity, defs));
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = fromForm(form.values, defs);
    if ("error" in parsed) return toast.error(parsed.error);
    setSaving(true);
    if (await patch(parsed.data, "Details saved.")) form.markSaved(form.values);
    setSaving(false);
  }

  return (
    <form onSubmit={onSubmit} aria-label="Details">
      <div className="card">
        <EntityFields defs={defs} values={form.values} onChange={form.setValues} />
      </div>
      <SaveBar dirty={form.dirty} saving={saving} onDiscard={form.discard} />
    </form>
  );
}

/** Images tab: poster, backdrop, logo and gallery picked from TMDB candidates. */
export function ImagesPage() {
  const { kind, entity, patch } = useEntity();
  const defs = onlyImages(kind === "movie" ? MOVIE_DEFS : SHOW_DEFS);
  return (
    <ChooseImages
      kind={kind === "movie" ? "movie" : "tv"}
      tmdbId={entity.tmdbId}
      initial={selectionFromValues(toForm(entity, defs))}
      onSave={(sel) => patch({ ...sel }, "Images saved.")}
    />
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="mb-0 break-words">{value || "-"}</dd>
    </div>
  );
}

/** Overview tab: artwork, key facts, publish switch, quick links and the danger zone. */
export function OverviewPage({ counts }: { counts: Record<string, number> }) {
  const { kind, entity, title, base, patch } = useEntity();
  const confirm = useConfirm();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  const backdrop = tmdbImage(entity.backdropPath, "w780");
  const poster = tmdbImage(entity.posterPath, "w342");
  const str = (k: string) => (typeof entity[k] === "string" ? (entity[k] as string) : "");
  const genres = Array.isArray(entity.genres) ? (entity.genres as string[]).join(", ") : "";
  const rating = typeof entity.rating === "number" ? `${entity.rating.toFixed(1)} / 10` : "";

  const links =
    kind === "movie"
      ? [
          ["/details", "Edit details"],
          ["/images", "Choose images"],
          ["/videos", "Manage videos"],
          ["/sources", "Add sources"],
          ["/subtitles", "Add subtitles"],
        ]
      : [
          ["/details", "Edit details"],
          ["/images", "Choose images"],
          ["/videos", "Manage videos"],
          ["/seasons", "Manage seasons"],
        ];

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const cascade =
    kind === "movie"
      ? [plural(counts.sources, "source"), plural(counts.subtitles, "subtitle"), plural(counts.videos, "video")]
      : [
          plural(counts.seasons, "season"),
          plural(counts.episodes, "episode"),
          plural(counts.sources, "source"),
          plural(counts.subtitles, "subtitle"),
          plural(counts.videos, "video"),
        ];

  async function remove() {
    const ok = await confirm({
      title: `Delete this ${kind}?`,
      confirmLabel: `Delete ${kind}`,
      body: (
        <>
          <p>
            This permanently deletes <strong>{title}</strong> and everything under it: {cascade.slice(0, -1).join(", ")} and{" "}
            {cascade[cascade.length - 1]}.
          </p>
          <p className="mt-2">This cannot be undone.</p>
        </>
      ),
    });
    if (!ok) return;
    setDeleting(true);
    const res = await adminApi("DELETE", `/api/admin/${kind}s/${entity.id}`);
    if (!res.ok) {
      setDeleting(false);
      return toast.error(errorText(res));
    }
    navigate(`/admin/${kind}s`);
  }

  return (
    <>
      <section className="card overflow-hidden p-0">
        {backdrop && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={backdrop} alt="Backdrop" className="aspect-video max-h-72 w-full object-cover" />
        )}
        <div className="flex flex-wrap gap-4 p-4">
          {poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="Poster" width={120} className="w-28 self-start rounded-md" />
          )}
          <dl className="grid min-w-0 flex-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <Fact label="Status" value={str("status")} />
            <Fact label={kind === "movie" ? "Release date" : "First air date"} value={str(kind === "movie" ? "releaseDate" : "firstAirDate")} />
            {kind === "movie" ? (
              <Fact label="Runtime" value={entity.runtimeMinutes ? `${entity.runtimeMinutes} min` : ""} />
            ) : (
              <Fact label="Last air date" value={str("lastAirDate")} />
            )}
            <Fact label="Rating" value={rating} />
            <Fact label="Language" value={str("originalLanguage")} />
            <Fact label="Genres" value={genres} />
            <Fact label="TMDB id" value={entity.tmdbId} />
            <Fact label="Tagline" value={str("tagline")} />
          </dl>
        </div>
      </section>

      <section className="card">
        <h2 className="text-base">Visibility</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Only published titles appear on the public site.</p>
        <p className="mt-3">
          <Switch
            checked={entity.isPublished}
            label="Published"
            onLabel="Published"
            offLabel="Draft (not public)"
            onToggle={(next) => patch({ isPublished: next }, next ? "Published." : "Unpublished.")}
          />
        </p>
      </section>

      <section className="card">
        <h2 className="text-base">Quick actions</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {links.map(([suffix, label]) => (
            <li key={suffix}>
              <Link href={`${base}${suffix}`} className="btn-link">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="danger-zone">
        <h2 className="text-base text-red-700 dark:text-red-300">Danger zone</h2>
        <p className="mt-1 text-sm">
          Deleting removes this {kind} and {cascade.join(", ")}.
        </p>
        <p className="mt-3">
          <button type="button" className="btn-danger" disabled={deleting} onClick={remove}>
            {deleting ? "Deleting..." : `Delete ${kind}`}
          </button>
        </p>
      </section>
    </>
  );
}

/** Videos tab for a movie or show. */
export function VideosPage() {
  const { kind, entity } = useEntity();
  return <VideosSection parent={kind === "movie" ? { movieId: entity.id } : { showId: entity.id }} />;
}

/** Sources tab (movies only). */
export function SourcesPage() {
  return <SourcesSection parent={{ movieId: useEntity().entity.id }} />;
}

/** Subtitles tab (movies only). */
export function SubtitlesPage() {
  return <SubtitlesSection parent={{ movieId: useEntity().entity.id }} />;
}
