"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { adminApi, errorText, tmdbImage } from "@/lib/client/admin";
import { navigate } from "@/lib/client/api";
import { useConfirm } from "./confirm-dialog";
import { useEntity } from "./entity-shell";
import { EPISODE_DEFS, EntityFields, SEASON_DEFS, fromForm, toForm } from "./fields";
import { SaveBar, useDirtyForm } from "./form-kit";
import { SeasonImagePicker } from "./image-picker";
import { SourcesSection, SubtitlesSection } from "./items-section";
import { Switch } from "./switch";
import { useToast } from "./toast";

export type SeasonRecord = {
  id: string;
  seasonNumber: number;
  name: string;
  overview: string;
  airDate: string | null;
  posterPath: string | null;
  isVisible: boolean;
};
export type EpisodeRecord = {
  id: string;
  episodeNumber: number;
  name: string;
  overview: string;
  airDate: string | null;
  runtimeMinutes: number | null;
  stillPath: string | null;
  isVisible: boolean;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** PATCH helper returning true on success, toasting the API message otherwise. */
function usePatcher(endpoint: string, id: string) {
  const toast = useToast();
  return async (body: Record<string, unknown>, success: string) => {
    const res = await adminApi("PATCH", `${endpoint}/${id}`, body);
    if (!res.ok) {
      toast.error(errorText(res));
      return false;
    }
    if (success) toast.success(success);
    return true;
  };
}

function SeasonRowItem({ s, base, onToggle }: { s: SeasonRecord & { episodeCount: number }; base: string; onToggle: (next: boolean) => Promise<boolean> }) {
  const img = tmdbImage(s.posterPath, "w92");
  return (
    <li>
      <span className="flex min-w-0 items-center gap-3">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" width={36} height={54} loading="lazy" className="h-[54px] w-9 shrink-0 rounded object-cover" />
        ) : (
          <span className="h-[54px] w-9 shrink-0 rounded bg-gray-200 dark:bg-gray-800" aria-hidden="true" />
        )}
        <span className="min-w-0">
          <Link href={`${base}/seasons/${s.seasonNumber}`} className="break-words font-medium">
            Season {s.seasonNumber}
            {s.name ? `: ${s.name}` : ""}
          </Link>
          <small className="block">{plural(s.episodeCount, "episode")}</small>
        </span>
      </span>
      <span className="toolbar">
        <Switch checked={s.isVisible} label={`Season ${s.seasonNumber} visible`} onLabel="Visible" offLabel="Hidden" onToggle={onToggle} />
        <Link href={`${base}/seasons/${s.seasonNumber}`} className="btn-link">
          Manage episodes
        </Link>
      </span>
    </li>
  );
}

/** Seasons tab: one row per season with a visibility switch and a link to its episodes. */
export function SeasonsPage({ initial }: { initial: (SeasonRecord & { episodeCount: number })[] }) {
  const { base } = useEntity();
  const [rows, setRows] = useState(initial);
  const toast = useToast();

  async function toggle(id: string, next: boolean) {
    const res = await adminApi("PATCH", `/api/admin/seasons/${id}`, { isVisible: next });
    if (!res.ok) {
      toast.error(errorText(res));
      return false;
    }
    setRows((all) => all.map((r) => (r.id === id ? { ...r, isVisible: next } : r)));
    return true;
  }

  if (rows.length === 0) {
    return <p className="card text-center">This show has no seasons.</p>;
  }
  return (
    <ul className="rows">
      {rows.map((s) => (
        <SeasonRowItem key={s.id} s={s} base={base} onToggle={(next) => toggle(s.id, next)} />
      ))}
    </ul>
  );
}

type EpisodeRow = EpisodeRecord & { sourceCount: number; subtitleCount: number };

/** Season page: season fields, visibility, image and the episode table with bulk show/hide. */
export function SeasonPage({ season, episodes }: { season: SeasonRecord; episodes: EpisodeRow[] }) {
  const { entity, base } = useEntity();
  const toast = useToast();
  const confirm = useConfirm();
  const patchSeason = usePatcher("/api/admin/seasons", season.id);
  const form = useDirtyForm(toForm(season, SEASON_DEFS));
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(season.isVisible);
  const [eps, setEps] = useState(episodes);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const textDefs = SEASON_DEFS.filter((d) => d.key !== "posterPath");
  const poster = tmdbImage(String(form.values.posterPath || ""), "w185");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = fromForm(form.values, SEASON_DEFS);
    if ("error" in parsed) return toast.error(parsed.error);
    setSaving(true);
    const ok = await patchSeason(parsed.data, "Season saved.");
    setSaving(false);
    if (!ok) return;
    form.markSaved(form.values);
    if (parsed.data.seasonNumber !== season.seasonNumber) navigate(`${base}/seasons/${parsed.data.seasonNumber}`);
  }

  async function toggleEpisode(id: string, next: boolean) {
    const res = await adminApi("PATCH", `/api/admin/episodes/${id}`, { isVisible: next });
    if (!res.ok) {
      toast.error(errorText(res));
      return false;
    }
    setEps((all) => all.map((e) => (e.id === id ? { ...e, isVisible: next } : e)));
    return true;
  }

  async function setAll(next: boolean) {
    const before = eps;
    setEps(before.map((e) => ({ ...e, isVisible: next })));
    setBulkBusy(true);
    const res = await adminApi<{ updated: number }>("PATCH", `/api/admin/seasons/${season.id}/episodes`, { isVisible: next });
    setBulkBusy(false);
    if (!res.ok) {
      setEps(before);
      return toast.error(errorText(res));
    }
    toast.success(`${plural(res.updated, "episode")} ${next ? "shown" : "hidden"}.`);
  }

  async function remove() {
    const sources = eps.reduce((n, e) => n + e.sourceCount, 0);
    const subs = eps.reduce((n, e) => n + e.subtitleCount, 0);
    const ok = await confirm({
      title: `Delete season ${season.seasonNumber}?`,
      confirmLabel: "Delete season",
      body: `This deletes the season, ${plural(eps.length, "episode")}, ${plural(sources, "source")} and ${plural(subs, "subtitle")}. This cannot be undone.`,
    });
    if (!ok) return;
    setDeleting(true);
    const res = await adminApi("DELETE", `/api/admin/seasons/${season.id}`);
    if (!res.ok) {
      setDeleting(false);
      return toast.error(errorText(res));
    }
    navigate(`${base}/seasons`);
  }

  return (
    <>
      <p>
        <Link href={`${base}/seasons`}>&larr; All seasons</Link>
      </p>
      <form onSubmit={onSubmit} aria-label="Season details">
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base">Season {season.seasonNumber}</h2>
            <Switch
              checked={visible}
              label="Season visible"
              onLabel="Visible"
              offLabel="Hidden"
              onToggle={async (next) => {
                const ok = await patchSeason({ isVisible: next }, next ? "Season visible." : "Season hidden.");
                if (ok) setVisible(next);
                return ok;
              }}
            />
          </div>
          <div className="flex flex-wrap items-start gap-4">
            {poster ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poster} alt={`Season ${season.seasonNumber} poster`} width={92} height={138} className="w-24 rounded-md" />
            ) : (
              <small>No season image</small>
            )}
            <div className="min-w-0 flex-1">
              <SeasonImagePicker
                tmdbId={entity.tmdbId}
                seasonNumber={season.seasonNumber}
                value={String(form.values.posterPath || "") || null}
                onChange={(p) => form.setValues({ ...form.values, posterPath: p ?? "" })}
              />
            </div>
          </div>
          <EntityFields defs={textDefs} values={form.values} onChange={form.setValues} />
        </section>
        <SaveBar dirty={form.dirty} saving={saving} onDiscard={form.discard} label="Save season" />
      </form>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base">Episodes ({eps.length})</h2>
          <span className="toolbar">
            <button type="button" className="btn-secondary" disabled={bulkBusy || eps.length === 0} onClick={() => setAll(true)}>
              Show all
            </button>
            <button type="button" className="btn-secondary" disabled={bulkBusy || eps.length === 0} onClick={() => setAll(false)}>
              Hide all
            </button>
          </span>
        </div>
        {eps.length === 0 ? (
          <p className="text-sm">No episodes in this season.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Name</th>
                  <th scope="col">Air date</th>
                  <th scope="col">Runtime</th>
                  <th scope="col">Visible</th>
                  <th scope="col">Sources</th>
                  <th scope="col">Subtitles</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {eps.map((e) => (
                  <tr key={e.id}>
                    <td>{e.episodeNumber}</td>
                    <td className="min-w-40">{e.name || <small>Untitled</small>}</td>
                    <td className="whitespace-nowrap">{e.airDate ?? "-"}</td>
                    <td className="whitespace-nowrap">{e.runtimeMinutes ? `${e.runtimeMinutes} min` : "-"}</td>
                    <td>
                      <Switch checked={e.isVisible} label={`Episode ${e.episodeNumber} visible`} onToggle={(next) => toggleEpisode(e.id, next)} />
                    </td>
                    <td>{e.sourceCount}</td>
                    <td>{e.subtitleCount}</td>
                    <td>
                      <Link href={`${base}/seasons/${season.seasonNumber}/episodes/${e.episodeNumber}`} className="btn-link">
                        Edit<span className="sr-only"> episode {e.episodeNumber}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="danger-zone">
        <h2 className="text-base text-red-700 dark:text-red-300">Danger zone</h2>
        <p className="mt-1 text-sm">Deleting removes this season with all its episodes, sources and subtitles.</p>
        <p className="mt-3">
          <button type="button" className="btn-danger" disabled={deleting} onClick={remove}>
            {deleting ? "Deleting..." : "Delete season"}
          </button>
        </p>
      </section>
    </>
  );
}

/** Episode page: fields, visibility, sources, subtitles and previous/next links. */
export function EpisodePage({
  seasonNumber,
  episode,
  prev,
  next,
}: {
  seasonNumber: number;
  episode: EpisodeRecord;
  prev: { episodeNumber: number; name: string } | null;
  next: { episodeNumber: number; name: string } | null;
}) {
  const { base } = useEntity();
  const toast = useToast();
  const confirm = useConfirm();
  const patchEpisode = usePatcher("/api/admin/episodes", episode.id);
  const form = useDirtyForm(toForm(episode, EPISODE_DEFS));
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(episode.isVisible);
  const [deleting, setDeleting] = useState(false);
  const seasonBase = `${base}/seasons/${seasonNumber}`;
  const still = tmdbImage(String(form.values.stillPath || ""), "w300");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = fromForm(form.values, EPISODE_DEFS);
    if ("error" in parsed) return toast.error(parsed.error);
    setSaving(true);
    const ok = await patchEpisode(parsed.data, "Episode saved.");
    setSaving(false);
    if (!ok) return;
    form.markSaved(form.values);
    if (parsed.data.episodeNumber !== episode.episodeNumber) navigate(`${seasonBase}/episodes/${parsed.data.episodeNumber}`);
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete episode ${episode.episodeNumber}?`,
      confirmLabel: "Delete episode",
      body: "This deletes the episode with all its sources and subtitles. This cannot be undone.",
    });
    if (!ok) return;
    setDeleting(true);
    const res = await adminApi("DELETE", `/api/admin/episodes/${episode.id}`);
    if (!res.ok) {
      setDeleting(false);
      return toast.error(errorText(res));
    }
    navigate(seasonBase);
  }

  const nav = (e: { episodeNumber: number; name: string } | null, label: string) =>
    e ? (
      <Link href={`${seasonBase}/episodes/${e.episodeNumber}`} className="btn-link">
        {label === "Previous" ? "← " : ""}
        {label}: E{e.episodeNumber}
        {label === "Next" ? " →" : ""}
      </Link>
    ) : (
      <span className="btn-link pointer-events-none opacity-50" aria-disabled="true">
        {label === "Previous" ? "← " : ""}
        {label}
        {label === "Next" ? " →" : ""}
      </span>
    );

  return (
    <>
      <div className="toolbar justify-between">
        <Link href={seasonBase}>&larr; Season {seasonNumber}</Link>
        <nav aria-label="Episode navigation" className="toolbar">
          {nav(prev, "Previous")}
          {nav(next, "Next")}
        </nav>
      </div>
      <form onSubmit={onSubmit} aria-label="Episode details">
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base">
              Episode {episode.episodeNumber}
              {episode.name ? `: ${episode.name}` : ""}
            </h2>
            <Switch
              checked={visible}
              label="Episode visible"
              onLabel="Visible"
              offLabel="Hidden"
              onToggle={async (n) => {
                const ok = await patchEpisode({ isVisible: n }, n ? "Episode visible." : "Episode hidden.");
                if (ok) setVisible(n);
                return ok;
              }}
            />
          </div>
          {still && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={still} alt="Episode still" width={300} className="w-full max-w-xs rounded-md" />
          )}
          <EntityFields defs={EPISODE_DEFS} values={form.values} onChange={form.setValues} />
        </section>
        <SaveBar dirty={form.dirty} saving={saving} onDiscard={form.discard} label="Save episode" />
      </form>
      <SourcesSection parent={{ episodeId: episode.id }} />
      <SubtitlesSection parent={{ episodeId: episode.id }} />
      <section className="danger-zone">
        <h2 className="text-base text-red-700 dark:text-red-300">Danger zone</h2>
        <p className="mt-1 text-sm">Deleting removes this episode with its sources and subtitles.</p>
        <p className="mt-3">
          <button type="button" className="btn-danger" disabled={deleting} onClick={remove}>
            {deleting ? "Deleting..." : "Delete episode"}
          </button>
        </p>
      </section>
    </>
  );
}
