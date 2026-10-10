import Link from "next/link";
import { imageUrl } from "@/lib/images";
import { BookmarkButton } from "./bookmarks";
import { InfoIcon, PlayIcon } from "./icons";
import { ratingText, runtimeText, yearOf } from "@/lib/viewer/format";

export type HeroProps = {
  title: string;
  tagline: string;
  overview: string;
  date: string | null;
  rating: number | null;
  runtimeMinutes?: number | null;
  genres: string[];
  backdropPath: string | null;
  logoPath: string | null;
  posterPath?: string | null;
  /** Detail pages show the full overview and the poster; the library hero clamps. */
  detail?: boolean;
  extra?: string;
  playHref: string | null;
  playLabel?: string;
  infoHref?: string;
  /** Rendered for h1 on detail pages; the home hero uses h2 so the page keeps one h1. */
  headingLevel?: 1 | 2;
  bookmark?: { kind: "movie" | "show"; id: string };
};

export function TitleHero(p: HeroProps) {
  const backdrop = imageUrl(p.backdropPath, "w1280");
  const logo = imageUrl(p.logoPath, "w500");
  const poster = imageUrl(p.posterPath, "w500");
  const Heading = p.headingLevel === 2 ? "h2" : "h1";
  const meta = [yearOf(p.date), runtimeText(p.runtimeMinutes), p.extra].filter(Boolean);
  const rating = ratingText(p.rating);
  return (
    <section className={`v-hero${p.detail ? " v-hero-slim" : ""}`} aria-label={p.title}>
      {backdrop && (
        // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
        <img className="v-hero-bg" src={backdrop} alt="" width={1280} height={720} decoding="async" fetchPriority="high" />
      )}
      <div className="v-hero-body">
        {p.detail && poster && (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
          <img className="v-hero-poster" src={poster} alt={`Poster for ${p.title}`} width={500} height={750} decoding="async" />
        )}
        <div className="v-hero-text">
          <Heading className={logo ? "v-sr" : "v-hero-title"}>{p.title}</Heading>
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
            <img className="v-hero-logo" src={logo} alt="" width={500} height={200} decoding="async" />
          )}
          <div className="v-meta">
            {rating && <span className="v-rating" aria-label={`Rated ${rating} out of 10`}>★ {rating}</span>}
            {meta.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>
          {p.genres.length > 0 && (
            <ul className="v-chips" aria-label="Genres">
              {p.genres.map((g) => (
                <li key={g}>
                  <Link href={`/search?genre=${encodeURIComponent(g)}`} className="v-chip">
                    {g}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {p.tagline && <p className="v-tagline">{p.tagline}</p>}
          {p.overview && <p className={`v-overview${p.detail ? " v-overview-full" : ""}`}>{p.overview}</p>}
          <div className="v-actions">
            {p.playHref ? (
              <Link href={p.playHref} className="v-btn v-btn-play" prefetch={false}>
                <PlayIcon size={20} /> {p.playLabel ?? "Play"}
              </Link>
            ) : (
              <span className="v-btn" aria-disabled="true">Not available yet</span>
            )}
            {p.bookmark && <BookmarkButton kind={p.bookmark.kind} id={p.bookmark.id} />}
            {p.infoHref && (
              <Link href={p.infoHref} className="v-btn v-btn-info">
                <InfoIcon size={20} /> More info
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
