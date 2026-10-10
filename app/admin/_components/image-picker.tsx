"use client";

import { FormEvent, useEffect, useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { pickImages } from "@/lib/cms/image-pick";
import {
  GALLERY_MAX,
  imageUrl,
  type ImageCandidate,
  type ImageCandidates,
  type ImageSelection,
} from "@/lib/images";
import type { FormValues } from "./fields";
import { SaveBar, useDirtyForm } from "./form-kit";

/** Reads the picker selection out of the entity form values. */
export function selectionFromValues(v: FormValues): ImageSelection {
  const s = (k: string) => String(v[k] ?? "").trim() || null;
  return {
    posterPath: s("posterPath"),
    backdropPath: s("backdropPath"),
    logoPath: s("logoPath"),
    galleryBackdrops: String(v.galleryBackdrops ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  };
}

/** Writes a selection back into the form values. */
export function valuesWithSelection(v: FormValues, sel: ImageSelection): FormValues {
  return {
    ...v,
    posterPath: sel.posterPath ?? "",
    backdropPath: sel.backdropPath ?? "",
    logoPath: sel.logoPath ?? "",
    galleryBackdrops: sel.galleryBackdrops.join(", "),
  };
}

function Meta({ c }: { c: ImageCandidate }) {
  return (
    <span className="tile-meta">
      <span className="badge">
        {c.width}x{c.height}
      </span>
      <span className="badge">{c.language ?? "no text"}</span>
      {c.voteAverage > 0 && <span className="badge">{c.voteAverage.toFixed(1)}</span>}
    </span>
  );
}

function Tile({
  c,
  label,
  size,
  selected,
  onClick,
  order,
  logo,
}: {
  c: ImageCandidate;
  label: string;
  size: string;
  selected: boolean;
  onClick: () => void;
  order?: number;
  logo?: boolean;
}) {
  const width = size === "w185" ? 185 : 300;
  return (
    <li>
      <button type="button" className={`tile ${logo ? "tile-logo" : ""}`} aria-pressed={selected} onClick={onClick}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl(c.filePath, size)!}
          alt={`${label}, ${c.width} by ${c.height}, ${c.language ?? "no text"}`}
          width={width}
          height={Math.round((width * c.height) / Math.max(c.width, 1))}
          loading="lazy"
        />
        {order !== undefined && <span className="tile-order" aria-hidden="true">{order}</span>}
        {selected && order === undefined && <span className="tile-flag" aria-hidden="true">Selected</span>}
        <Meta c={c} />
      </button>
    </li>
  );
}

function Grid({ title, hint, wide, children }: { title: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <h3>{title}</h3>
      {hint && <small>{hint}</small>}
      <ul className={`mt-3 ${wide ? "img-grid-wide" : "img-grid"}`}>{children}</ul>
    </section>
  );
}

/**
 * Controlled gallery picker: one poster, one backdrop, one logo and up to 5
 * extra backdrops, chosen from TMDB candidates.
 */
export function ImagePicker({
  candidates,
  value,
  onChange,
}: {
  candidates: ImageCandidates;
  value: ImageSelection;
  onChange: (next: ImageSelection) => void;
}) {
  const { posters, backdrops, logos } = candidates;
  const set = (patch: Partial<ImageSelection>) => onChange({ ...value, ...patch });
  const gallery = value.galleryBackdrops;
  const byPath = new Map(backdrops.map((b) => [b.filePath, b]));

  const toggle = (path: string) => {
    if (gallery.includes(path)) return set({ galleryBackdrops: gallery.filter((p) => p !== path) });
    if (gallery.length >= GALLERY_MAX) return;
    set({ galleryBackdrops: [...gallery, path] });
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= gallery.length) return;
    const next = [...gallery];
    [next[i], next[j]] = [next[j], next[i]];
    set({ galleryBackdrops: next });
  };
  const pickMain = (path: string) =>
    set({
      backdropPath: value.backdropPath === path ? null : path,
      galleryBackdrops: gallery.filter((p) => p !== path),
    });

  return (
    <div className="space-y-6">
      <p className="toolbar">
        <button type="button" className="btn-secondary" onClick={() => onChange(pickImages(candidates))}>
          Reset to auto-pick
        </button>
        <small>
          {posters.length} posters, {backdrops.length} backdrops, {logos.length} logos
        </small>
      </p>

      <Grid title="Main poster" hint="Click to select one." >
        {posters.map((c) => (
          <Tile
            key={c.filePath}
            c={c}
            label="Poster"
            size="w185"
            selected={value.posterPath === c.filePath}
            onClick={() => set({ posterPath: value.posterPath === c.filePath ? null : c.filePath })}
          />
        ))}
      </Grid>

      <Grid title="Main backdrop" hint="Click to select one." wide>
        {backdrops.map((c) => (
          <Tile
            key={c.filePath}
            c={c}
            label="Backdrop"
            size="w300"
            selected={value.backdropPath === c.filePath}
            onClick={() => pickMain(c.filePath)}
          />
        ))}
      </Grid>

      <Grid title="Logo" hint="Click to select one; English logos rank first." >
        {logos.map((c) => (
          <Tile
            key={c.filePath}
            c={c}
            label="Logo"
            size="w185"
            logo
            selected={value.logoPath === c.filePath}
            onClick={() => set({ logoPath: value.logoPath === c.filePath ? null : c.filePath })}
          />
        ))}
      </Grid>

      <Grid
        title={`Gallery backdrops (${gallery.length} of ${GALLERY_MAX})`}
        hint="Click to add or remove, up to 5. The numbers show the order."
        wide
      >
        {backdrops
          .filter((c) => c.filePath !== value.backdropPath)
          .map((c) => {
            const idx = gallery.indexOf(c.filePath);
            return (
              <Tile
                key={c.filePath}
                c={c}
                label="Gallery backdrop"
                size="w300"
                selected={idx >= 0}
                order={idx >= 0 ? idx + 1 : undefined}
                onClick={() => toggle(c.filePath)}
              />
            );
          })}
      </Grid>
      {gallery.length >= GALLERY_MAX && <p role="status">Gallery is full (5). Remove one to add another.</p>}

      {gallery.length > 0 && (
        <section>
          <h3>Gallery order</h3>
          <ol className="rows mt-3">
            {gallery.map((p, i) => {
              const c = byPath.get(p);
              return (
                <li key={p}>
                  <span className="flex items-center gap-3">
                    <strong>{i + 1}.</strong>
                    {imageUrl(p, "w185") && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imageUrl(p, "w185")!} alt={`Gallery backdrop ${i + 1}`} width={120} height={68} loading="lazy" className="w-28 rounded" />
                    )}
                    {c && <small>{c.width}x{c.height}</small>}
                  </span>
                  <span className="toolbar">
                    <button type="button" className="btn-secondary" disabled={i === 0} onClick={() => move(i, -1)}>
                      Up<span className="sr-only"> backdrop {i + 1}</span>
                    </button>
                    <button type="button" className="btn-secondary" disabled={i === gallery.length - 1} onClick={() => move(i, 1)}>
                      Down<span className="sr-only"> backdrop {i + 1}</span>
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => toggle(p)}>
                      Remove<span className="sr-only"> backdrop {i + 1}</span>
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

/** Images tab: loads candidates live from TMDB; Save stays disabled until the selection changed. */
export function ChooseImages({
  kind,
  tmdbId,
  initial,
  onSave,
}: {
  kind: "movie" | "tv";
  tmdbId: number;
  initial: ImageSelection;
  /** Persists the selection (PATCH); resolves true on success. */
  onSave: (sel: ImageSelection) => Promise<boolean>;
}) {
  const [candidates, setCandidates] = useState<ImageCandidates | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const form = useDirtyForm(valuesWithSelection({}, initial));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await adminApi<ImageCandidates>("GET", `/api/admin/tmdb/${kind}/${tmdbId}/images`);
      if (cancelled) return;
      if (!res.ok) return setError(errorText(res));
      setError("");
      setCandidates({ posters: res.posters, backdrops: res.backdrops, logos: res.logos });
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, tmdbId, attempt]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    if (await onSave(selectionFromValues(form.values))) form.markSaved(form.values);
    setSaving(false);
  }

  return (
    <form onSubmit={submit}>
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setCandidates(null);
              setError("");
              setAttempt((a) => a + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}
      {!candidates && !error && (
        <div className="space-y-3" aria-busy="true">
          <p className="flex items-center gap-2 text-sm">
            <span className="spinner" aria-hidden="true" /> Loading images from TMDB...
          </p>
          <div className="skeleton h-48" />
        </div>
      )}
      {candidates && (
        <ImagePicker
          candidates={candidates}
          value={selectionFromValues(form.values)}
          onChange={(sel) => form.setValues(valuesWithSelection(form.values, sel))}
        />
      )}
      <SaveBar dirty={form.dirty} saving={saving} onDiscard={form.discard} label="Save images" />
    </form>
  );
}

/** Season poster chooser (single select). `onChange(null)` clears. */
export function SeasonImagePicker({
  tmdbId,
  seasonNumber,
  value,
  onChange,
  onSave,
}: {
  tmdbId: number;
  seasonNumber: number;
  value: string | null;
  onChange: (path: string | null) => void;
  /** When given, shows Save/Clear buttons that persist the choice. */
  onSave?: (path: string | null) => Promise<boolean>;
}) {
  const [posters, setPosters] = useState<ImageCandidate[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    setBusy(true);
    const res = await adminApi<{ posters: ImageCandidate[] }>(
      "GET",
      `/api/admin/tmdb/tv/${tmdbId}/season/${seasonNumber}/images`,
    );
    setBusy(false);
    if (!res.ok) return setError(errorText(res));
    setPosters(res.posters);
  }

  return (
    <details
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && !posters && !busy) void load();
      }}
    >
      <summary>Choose season image</summary>
      {busy && <p role="status">Loading season images...</p>}
      {error && <p role="alert">{error}</p>}
      {posters && posters.length === 0 && <p>TMDB has no images for this season.</p>}
      {posters && posters.length > 0 && (
        <ul className="img-grid mt-3">
          {posters.map((c) => (
            <Tile
              key={c.filePath}
              c={c}
              label={`Season ${seasonNumber} poster`}
              size="w185"
              selected={value === c.filePath}
              onClick={() => onChange(value === c.filePath ? null : c.filePath)}
            />
          ))}
        </ul>
      )}
      {onSave && (
        <p className="toolbar">
          <button type="button" disabled={busy} onClick={() => onSave(value)}>
            Save season image
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !value}
            onClick={async () => {
              if (await onSave(null)) onChange(null);
            }}
          >
            Clear season image
          </button>
        </p>
      )}
    </details>
  );
}
