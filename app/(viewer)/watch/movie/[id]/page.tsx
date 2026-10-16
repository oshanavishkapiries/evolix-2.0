import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AUDIO_COOKIE } from "@/lib/audio";
import { chooseAudio } from "@/lib/viewer/audio";
import { ensureMovie } from "@/lib/evo/ensure";
import { isUuid, parseMediaId } from "@/lib/viewer/ids";
import { runtimeText, yearOf } from "@/lib/viewer/format";
import { resumePosition } from "@/lib/viewer/library";
import { canWatch } from "@/lib/viewer/access";
import { currentUserId } from "@/lib/viewer/user";
import { ApprovalNotice } from "../../../_components/approval-notice";
import { getMovieWatch } from "@/lib/viewer/watch";
import { WatchView } from "../../../_components/watch-view";

// Blocking on purpose: the id is resolved before the response starts, so a missing or
// unpublished title is a real HTTP 404 instead of a streamed 200.
export const instant = false;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ source?: string | string[]; lang?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const movie = parseMediaId(id) ? await getMovieWatch(id) : null;
  return { title: movie ? `Watch ${movie.title}` : "Not found", robots: { index: false, follow: false } };
}

export default async function WatchMoviePage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!parseMediaId(id)) notFound();
  const movie = await getMovieWatch(id);
  if (!movie) notFound();
  const userId = await currentUserId();
  if (!(await canWatch(userId))) return <ApprovalNotice />;
  // Evo titles start as TMDB-only ("tmdb-123"); signed-in viewers get a catalog row so progress and reports have something to attach to.
  const rowId = isUuid(movie.id) ? movie.id : userId ? await ensureMovie(movie.tmdbId).catch(() => null) : null;
  const startAt = userId && rowId ? await resumePosition(userId, { movieId: rowId }) : 0;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const audio = chooseAudio(movie.sources, { source: one(sp.source), lang: one(sp.lang), saved: (await cookies()).get(AUDIO_COOKIE)?.value });

  return (
    <WatchView
      heading={movie.title}
      sub={yearOf(movie.releaseDate)}
      backHref={`/movie/${movie.id}`}
      backLabel="Details"
      basePath={`/watch/movie/${movie.id}`}
      sources={audio.visible}
      subtitles={movie.subtitles}
      selected={audio.selected}
      tmdbId={movie.tmdbId}
      mediaType="movie"
      backdropPath={movie.backdropPath}
      audio={audio}
      track={rowId ? { kind: "movie", id: rowId } : undefined}
      startAt={startAt}
      report={rowId ? { kind: "movie", id: rowId, title: movie.title } : undefined}
      info={{
        title: movie.title,
        meta: [yearOf(movie.releaseDate), runtimeText(movie.runtimeMinutes), movie.rating ? `★ ${movie.rating.toFixed(1)}` : ""].filter(Boolean).join(" · "),
        overview: movie.overview,
        backdropPath: movie.backdropPath,
      }}
    />
  );
}
