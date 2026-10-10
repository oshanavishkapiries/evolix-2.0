import Link from "next/link";
import { imageUrl } from "@/lib/images";
import { ratingText, yearOf } from "@/lib/viewer/format";
import { BookmarkButton } from "./bookmarks";
import { Overview, PosterTint, ShareButton } from "./detail-client";
import { FilmPlayIcon, PlayIcon } from "./icons";

export type PlayAction = { href: string; label: string; detail?: string; percent?: number };

type Props = {
  kind: "movie" | "show";
  id: string;
  title: string;
  tagline: string;
  overview: string;
  date: string | null;
  rating: number | null;
  genres: string[];
  facts: string[];
  posterPath: string | null;
  backdropPath: string | null;
  play: PlayAction | null;
  hasTrailer: boolean;
};

/** Plex-style detail header (spec §5.5): poster left, metadata and actions right, tinted page. */
export function DetailHeader(p: Props) {
  const poster = imageUrl(p.posterPath, "w500");
  const backdrop = imageUrl(p.backdropPath, "w1280");
  const rating = ratingText(p.rating);
  const genres = p.genres.length > 3 ? `${p.genres.slice(0, 3).join(", ")}, and more` : p.genres.join(", ");
  return (
    <>
      <PosterTint src={imageUrl(p.posterPath, "w92")} />
      {backdrop && (
        // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, decorative
        <img className="v-detail-backdrop" src={backdrop} alt="" width={1280} height={720} decoding="async" />
      )}
      <div className="v-detail-head">
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
          <img className="v-detail-poster" src={poster} alt={`Poster for ${p.title}`} width={500} height={750} decoding="async" fetchPriority="high" />
        ) : (
          <div className="v-detail-poster v-card-ph">{p.title}</div>
        )}
        <div className="v-detail-info">
          <h1>{p.title}</h1>
          <div className="v-detail-meta">
            {yearOf(p.date) && <span>{yearOf(p.date)}</span>}
            {p.facts.map((f) => <span key={f}>{f}</span>)}
            {genres && <span>{genres}</span>}
          </div>
          {rating && (
            <div className="v-detail-ratings">
              <span className="v-score" aria-label={`Rated ${rating} out of 10 on TMDB`}>
                <span className="v-score-badge">TMDB</span> {rating}
              </span>
            </div>
          )}
          <div className="v-detail-actions">
            {p.play ? (
              <Link href={p.play.href} className="v-btn v-btn-primary v-btn-lg" prefetch={false}>
                <PlayIcon size={18} /> {p.play.label}
              </Link>
            ) : (
              <span className="v-btn v-btn-lg" aria-disabled="true">Not available yet</span>
            )}
            <BookmarkButton kind={p.kind} id={p.id} />
            {p.hasTrailer && (
              <a href="#trailers" className="v-round" aria-label="Trailers" title="Trailers">
                <FilmPlayIcon size={20} />
              </a>
            )}
            <ShareButton title={p.title} />
          </div>
          {p.play?.detail && (
            <div className="v-detail-progress">
              {typeof p.play.percent === "number" && p.play.percent > 0 && (
                <span className="v-progress" aria-hidden="true"><span style={{ width: `${p.play.percent}%` }} /></span>
              )}
              <span>{p.play.detail}</span>
            </div>
          )}
          {p.tagline && <p className="v-detail-tagline">{p.tagline}</p>}
          {p.overview && <Overview text={p.overview} />}
        </div>
      </div>
    </>
  );
}
