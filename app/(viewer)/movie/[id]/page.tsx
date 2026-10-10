import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/viewer/ids";
import { getMovieDetail } from "@/lib/viewer/detail";
import { yearOf } from "@/lib/viewer/format";
import { detailMetadata, MediaSections } from "../../_components/media-sections";
import { NavMarker } from "../../_components/nav-marker";
import { TitleHero } from "../../_components/title-hero";

// Blocking on purpose: the id is resolved before the response starts, so a missing or
// unpublished title is a real HTTP 404 instead of a streamed 200.
export const instant = false;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const movie = isUuid(id) ? await getMovieDetail(id) : null;
  if (!movie) return { title: "Not found" };
  const year = yearOf(movie.releaseDate);
  return detailMetadata(year ? `${movie.title} (${year})` : movie.title, movie.overview, movie.backdropPath);
}

export default async function MoviePage({ params }: Props) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const movie = await getMovieDetail(id);
  if (!movie) notFound();

  return (
    <>
      <NavMarker active="movies" />
      <TitleHero
        detail
        title={movie.title}
        tagline={movie.tagline}
        overview={movie.overview}
        date={movie.releaseDate}
        rating={movie.rating}
        runtimeMinutes={movie.runtimeMinutes}
        genres={movie.genres}
        backdropPath={movie.backdropPath}
        logoPath={movie.logoPath}
        posterPath={movie.posterPath}
        bookmark={{ kind: "movie", id: movie.id }}
        playHref={movie.playable ? `/watch/movie/${movie.id}` : null}
      />
      <MediaSections item={movie} />
    </>
  );
}
