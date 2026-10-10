import Link from "next/link";
import { imageUrl } from "@/lib/images";
import { PlayIcon } from "./icons";
import { dateText, runtimeText } from "@/lib/viewer/format";
import type { ShowDetail } from "@/lib/viewer/detail";

export type EpisodeItem = {
  episodeNumber: number;
  name: string;
  overview?: string;
  airDate: string | null;
  runtimeMinutes: number | null;
  stillPath: string | null;
};

/** One row of an episode list; links to the watch page. */
export function EpisodeRow({
  showId,
  seasonNumber,
  ep,
  current = false,
  compact = false,
}: {
  showId: string;
  seasonNumber: number;
  ep: EpisodeItem;
  current?: boolean;
  compact?: boolean;
}) {
  const still = imageUrl(ep.stillPath, "w300");
  const title = ep.name || `Episode ${ep.episodeNumber}`;
  const meta = [dateText(ep.airDate), runtimeText(ep.runtimeMinutes)].filter(Boolean).join(" · ");
  return (
    <Link
      href={`/watch/tv/${showId}/${seasonNumber}/${ep.episodeNumber}`}
      className="v-ep"
      aria-current={current}
      prefetch={false}
    >
      <span className="v-ep-num">{ep.episodeNumber}</span>
      <span className="v-ep-still" style={{ display: "block" }}>
        {still && (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
          <img src={still} alt="" width={300} height={169} loading="lazy" decoding="async" />
        )}
        <span className="v-ep-play" aria-hidden="true"><span><PlayIcon size={22} /></span></span>
      </span>
      <span>
        <span className="v-ep-title" style={{ display: "block" }}>{title}</span>
        {meta && <span className="v-ep-meta" style={{ display: "block" }}>{meta}</span>}
        {!compact && ep.overview && <span className="v-ep-overview">{ep.overview}</span>}
      </span>
    </Link>
  );
}

/** Season posters; each opens the player straight away (the player has its own episode panel). */
export function Seasons({ show, resumeHref }: { show: ShowDetail; resumeHref?: string }) {
  const { seasons } = show;
  if (!seasons.length) {
    return (
      <section className="v-section" aria-labelledby="seasons-h">
        <h2 id="seasons-h">Seasons</h2>
        <p className="v-muted">No episodes available yet.</p>
      </section>
    );
  }
  const label = (s: (typeof seasons)[number]) => (s.seasonNumber === 0 ? "Specials" : `Season ${s.seasonNumber}`);
  return (
    <section className="v-section" aria-labelledby="seasons-h">
      <h2 id="seasons-h">Seasons</h2>
      <ul className="v-seasons">
        {seasons.map((s) => {
          const poster = imageUrl(s.posterPath ?? show.posterPath, "w342");
          const base = `/watch/tv/${show.id}/${s.seasonNumber}`;
          // Pick up where the viewer left off when they were last watching this season.
          const href = resumeHref?.startsWith(`${base}/`) ? resumeHref : s.firstEpisode != null ? `${base}/${s.firstEpisode}` : null;
          const inner = (
            <>
              <span className="v-card-img" style={{ display: "block" }}>
                {poster ? (
                  // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
                  <img src={poster} alt="" width={342} height={513} loading="lazy" decoding="async" />
                ) : (
                  <span className="v-card-ph">{label(s)}</span>
                )}
                {href && <span className="v-card-play" aria-hidden="true"><PlayIcon size={22} /></span>}
              </span>
              <span className="v-card-title">{s.name && s.seasonNumber !== 0 && s.name !== label(s) ? s.name : label(s)}</span>
              <span className="v-card-sub">{s.episodeCount} {s.episodeCount === 1 ? "episode" : "episodes"}</span>
            </>
          );
          return (
            <li key={s.id}>
              {href ? (
                <Link href={href} className="v-card" prefetch={false} aria-label={`Play ${label(s)}`}>{inner}</Link>
              ) : (
                <div className="v-card" aria-disabled="true">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
