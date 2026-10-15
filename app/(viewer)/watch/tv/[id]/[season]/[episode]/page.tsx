import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AUDIO_COOKIE } from "@/lib/audio";
import { chooseAudio } from "@/lib/viewer/audio";
import { isUuid, parseMediaId, parseNumber } from "@/lib/viewer/ids";
import { resumePosition } from "@/lib/viewer/library";
import { currentUserId } from "@/lib/viewer/user";
import { getEpisodeWatch, type EpisodeRef } from "@/lib/viewer/watch";
import { EpisodeRow } from "../../../../../_components/seasons";
import { WatchView } from "../../../../../_components/watch-view";

// Blocking on purpose: the id is resolved before the response starts, so a missing or
// unpublished title is a real HTTP 404 instead of a streamed 200.
export const instant = false;

type Params = { id: string; season: string; episode: string };
type Props = { params: Promise<Params>; searchParams: Promise<{ source?: string | string[]; lang?: string | string[] }> };

const code = (s: number, e: number) => `S${s}E${e}`;

function parse(p: Params) {
  const season = parseNumber(p.season, 1000);
  const episode = parseNumber(p.episode, 100_000);
  return parseMediaId(p.id) !== null && season !== null && episode !== null ? { id: p.id, season, episode } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = parse(await params);
  const data = p ? await getEpisodeWatch(p.id, p.season, p.episode) : null;
  return {
    title: data ? `${data.current.showName} ${code(p!.season, p!.episode)}` : "Not found",
    robots: { index: false, follow: false },
  };
}

export default async function WatchEpisodePage({ params, searchParams }: Props) {
  const [raw, sp] = await Promise.all([params, searchParams]);
  const p = parse(raw);
  if (!p) notFound();
  const data = await getEpisodeWatch(p.id, p.season, p.episode);
  if (!data) notFound();
  const { current, prev, next } = data;
  const userId = await currentUserId();
  const startAt = userId ? await resumePosition(userId, { episodeId: current.id }) : 0;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const audio = chooseAudio(data.sources, { source: one(sp.source), lang: one(sp.lang), saved: (await cookies()).get(AUDIO_COOKIE)?.value });
  const href = (e: EpisodeRef) => `/watch/tv/${p.id}/${e.seasonNumber}/${e.episodeNumber}`;
  const label = (e: EpisodeRef) => (e.seasonNumber === p.season ? `Episode ${e.episodeNumber}` : code(e.seasonNumber, e.episodeNumber));

  return (
    <WatchView
      heading={`${current.showName}: ${code(p.season, p.episode)}${current.name ? ` ${current.name}` : ""}`}
      backHref={`/tv/${p.id}?season=${p.season}`}
      backLabel={current.showName}
      basePath={href({ seasonNumber: p.season, episodeNumber: p.episode, name: "" })}
      sources={audio.visible}
      subtitles={data.subtitles}
      selected={audio.selected}
      tmdbId={current.tmdbId}
      mediaType="tv"
      season={p.season}
      episode={p.episode}
      backdropPath={current.backdropPath}
      audio={audio}
      track={isUuid(current.id) ? { kind: "episode", id: current.id } : undefined}
      startAt={startAt}
      report={isUuid(current.id) ? { kind: "episode", id: current.id, title: `${current.showName} ${code(p.season, p.episode)}` } : undefined}
      info={{
        title: current.showName,
        meta: `S${p.season}:E${p.episode}${current.name ? ` · ${current.name}` : ""}`,
        overview: current.overview,
        backdropPath: current.stillPath ?? current.backdropPath,
      }}
      nav={
        <nav className="v-epnav" aria-label="Episode navigation">
          {prev ? <Link href={href(prev)} className="v-btn" prefetch={false}>← Previous: {label(prev)}</Link> : <span className="v-btn" aria-disabled="true">← Previous</span>}
          {next ? <Link href={href(next)} className="v-btn v-btn-primary" prefetch={false}>Next: {label(next)} →</Link> : <span className="v-btn" aria-disabled="true">Next →</span>}
        </nav>
      }
      side={
        <>
          <h2>{current.seasonName || `Season ${p.season}`}</h2>
          <ul className="v-episodes">
            {data.seasonEpisodes.map((e) => (
              <li key={e.id}>
                <EpisodeRow
                  showId={p.id}
                  seasonNumber={p.season}
                  ep={{ ...e, overview: undefined }}
                  current={e.episodeNumber === p.episode}
                  compact
                />
              </li>
            ))}
          </ul>
        </>
      }
    />
  );
}
