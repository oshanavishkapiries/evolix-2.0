import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseMediaId } from "@/lib/viewer/ids";
import { getMovieDetail } from "@/lib/viewer/detail";
import { dateText, languageName, runtimeText, yearOf } from "@/lib/viewer/format";
import { resumeFor } from "@/lib/viewer/library";
import { currentUserId } from "@/lib/viewer/user";
import { DetailHeader, type PlayAction } from "../../_components/detail-header";
import { detailMetadata, MediaSections } from "../../_components/media-sections";
import { PageMotion } from "../../_components/motion";

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

const left = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m} min left`);

export default async function MoviePage({ params }: Props) {
  const { id } = await params;
  if (!parseMediaId(id)) notFound();
  const [movie, userId] = await Promise.all([getMovieDetail(id), currentUserId()]);
  if (!movie) notFound();
  const resume = userId && movie.playable ? await resumeFor(userId, "movie", movie.id) : null;
  const href = `/watch/movie/${movie.id}`;
  const play: PlayAction | null = !movie.playable
    ? null
    : resume
      ? { href, label: "Resume", detail: resume.leftMinutes ? left(resume.leftMinutes) : undefined, percent: resume.percent }
      : { href, label: "Play" };

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
        voteCount={movie.voteCount}
        hasExtras={movie.videos.length > 0}
        dubs={movie.dubs}
      />
      <MediaSections
        item={movie}
        facts={[
          ["Original title", movie.originalTitle && movie.originalTitle !== movie.title ? movie.originalTitle : ""],
          ["Release date", dateText(movie.releaseDate)],
          ["Runtime", runtimeText(movie.runtimeMinutes)],
          ["Status", movie.status],
          ["Original language", languageName(movie.originalLanguage)],
          ["Genres", movie.genres.join(", ")],
        ]}
      />
    </div>
    </PageMotion>
  );
}
