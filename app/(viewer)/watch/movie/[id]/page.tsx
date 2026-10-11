import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/viewer/ids";
import { runtimeText, yearOf } from "@/lib/viewer/format";
import { resumePosition } from "@/lib/viewer/library";
import { currentUserId } from "@/lib/viewer/user";
import { getMovieWatch } from "@/lib/viewer/watch";
import { pickSource, WatchView } from "../../../_components/watch-view";

// Blocking on purpose: the id is resolved before the response starts, so a missing or
// unpublished title is a real HTTP 404 instead of a streamed 200.
export const instant = false;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const movie = isUuid(id) ? await getMovieWatch(id) : null;
  return { title: movie ? `Watch ${movie.title}` : "Not found", robots: { index: false, follow: false } };
}

export default async function WatchMoviePage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  const movie = await getMovieWatch(id);
  if (!movie) notFound();
  const userId = await currentUserId();
  const startAt = userId ? await resumePosition(userId, { movieId: movie.id }) : 0;
  const selected = pickSource(movie.sources, Array.isArray(sp.source) ? sp.source[0] : sp.source);

  return (
    <WatchView
      heading={movie.title}
      sub={yearOf(movie.releaseDate)}
      backHref={`/movie/${movie.id}`}
      backLabel="Details"
      basePath={`/watch/movie/${movie.id}`}
      sources={movie.sources}
      subtitles={movie.subtitles}
      selected={selected}
      track={{ kind: "movie", id: movie.id }}
      startAt={startAt}
      info={{
        title: movie.title,
        meta: [yearOf(movie.releaseDate), runtimeText(movie.runtimeMinutes), movie.rating ? `★ ${movie.rating.toFixed(1)}` : ""].filter(Boolean).join(" · "),
        overview: movie.overview,
        backdropPath: movie.backdropPath,
      }}
    />
  );
}
