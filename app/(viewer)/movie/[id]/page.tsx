import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseMediaId } from "@/lib/viewer/ids";
import { getMovieDetail } from "@/lib/viewer/detail";
import { dateText, languageName, runtimeText, yearOf } from "@/lib/viewer/format";
import { DetailHeader } from "../../_components/detail-header";
import { detailMetadata } from "../../_components/media-sections";
import { DetailPersonalPlay, DetailPersonalProgress, DetailPersonalDubs, DetailSections, DetailTrailerLink } from "../../_components/detail-streams";
import { RowSkeleton } from "../../_components/skeletons";
import { PageMotion } from "../../_components/motion";
import { PlayIcon } from "../../_components/icons";
import { PlayLink } from "../../_components/play-link";

// Blocking on purpose: the id is resolved before the response starts, so a missing or
// unpublished title is a real HTTP 404 instead of a streamed 200.
export const instant = false;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const movie = parseMediaId(id) ? await getMovieDetail(id) : null;
  if (!movie) return { title: "Not found" };
  const year = yearOf(movie.releaseDate);
  return detailMetadata(year ? `${movie.title} (${year})` : movie.title, movie.overview, movie.backdropPath);
}

export default async function MoviePage({ params }: Props) {
  const { id } = await params;
  if (!parseMediaId(id)) notFound();
  const movie = await getMovieDetail(id);
  if (!movie) notFound();
  const personal = { kind: "movie" as const, id: movie.id, playable: movie.playable };
  const play = movie.playable ? { href: `/watch/movie/${movie.id}`, label: "Play" } : null;

  return (
    <PageMotion>
    <div className="v-detail">
      <DetailHeader
        kind="movie"
        id={movie.id}
        title={movie.title}
        tagline={movie.tagline}
        overview={movie.overview}
        date={movie.releaseDate}
        rating={movie.rating}
        genres={movie.genres}
        facts={[runtimeText(movie.runtimeMinutes)].filter(Boolean)}
        posterPath={movie.posterPath}
        backdropPath={movie.backdropPath}
        play={play}
        // Fallback is a working Play link: the watch page resolves the resume position server-side anyway.
        playSlot={<Suspense fallback={play ? <PlayLink href={play.href} className="v-btn v-btn-primary v-btn-lg"><PlayIcon size={18} /> Play</PlayLink> : null}><DetailPersonalPlay {...personal} /></Suspense>}
        progressSlot={<Suspense fallback={null}><DetailPersonalProgress {...personal} /></Suspense>}
        extrasSlot={<Suspense fallback={null}><DetailTrailerLink kind="movie" item={movie} /></Suspense>}
        voteCount={movie.voteCount}
        dubsSlot={<Suspense fallback={null}><DetailPersonalDubs {...personal} dubs={movie.dubs} /></Suspense>}
      />
      <Suspense fallback={<RowSkeleton />}><DetailSections
        kind="movie"
        item={movie}
        facts={[
          ["Original title", movie.originalTitle && movie.originalTitle !== movie.title ? movie.originalTitle : ""],
          ["Release date", dateText(movie.releaseDate)],
          ["Runtime", runtimeText(movie.runtimeMinutes)],
          ["Status", movie.status],
          ["Original language", languageName(movie.originalLanguage)],
          ["Genres", movie.genres.join(", ")],
        ]}
      /></Suspense>
    </div>
    </PageMotion>
  );
}
