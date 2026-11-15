import { PlayLink } from "./play-link";
import { imageUrl, imageSrcSet, POSTER_ROW_SIZES } from "@/lib/images";
import { PlayIcon } from "./icons";
import { dateText, runtimeText } from "@/lib/viewer/format";
import type { ShowDetail } from "@/lib/viewer/detail";
import { isUpcoming } from "@/lib/viewer/availability";

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
  const upcoming = isUpcoming(ep.airDate);
  const meta = [upcoming ? `Coming soon · ${dateText(ep.airDate)}` : dateText(ep.airDate), runtimeText(ep.runtimeMinutes)].filter(Boolean).join(" · ");
  const inner = (
    <>
      <span className="v-ep-num">{ep.episodeNumber}</span>
      <span className="v-ep-still" style={{ display: "block" }}>
        {still && (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
          <img src={still} alt="" width={300} height={169} loading="lazy" decoding="async" />
        )}
        {!upcoming && <span className="v-ep-play" aria-hidden="true"><span><PlayIcon size={22} /></span></span>}
      </span>
      <span>
        <span className="v-ep-title" style={{ display: "block" }}>{title}</span>
        {meta && <span className="v-ep-meta" style={{ display: "block" }}>{meta}</span>}
        {!compact && ep.overview && <span className="v-ep-overview">{ep.overview}</span>}
      </span>
    </>
  );
  return upcoming ? (
    <div className="v-ep" aria-disabled="true">{inner}</div>
  ) : (
    <PlayLink href={`/watch/tv/${showId}/${seasonNumber}/${ep.episodeNumber}`} className="v-ep" aria-current={current}>{inner}</PlayLink>
  );
}

/** Season posters; each opens the player straight away (the player has its own episode panel). */
export function Seasons({ show, resumeHref }: { show: ShowDetail; resumeHref?: string }) {
  const seasons = show.seasons.filter((s) => s.seasonNumber > 0);
  if (!seasons.length) {
    return (
      <section className="v-section" aria-labelledby="seasons-h">
        <h2 id="seasons-h">Seasons</h2>
        <p className="v-muted">No episodes available yet.</p>
      </section>
    );
  }
  const label = (s: (typeof seasons)[number]) => `Season ${s.seasonNumber}`;
  return (
    <section className="v-section" aria-labelledby="seasons-h">
      <h2 id="seasons-h">Seasons</h2>
      <ul className="v-seasons">
        {seasons.map((s) => {
          const poster = imageSrcSet(s.posterPath ?? show.posterPath, "poster", 342);
          const base = `/watch/tv/${show.id}/${s.seasonNumber}`;
          // Pick up where the viewer left off when they were last watching this season.
          const href = s.firstEpisode == null ? null : resumeHref?.startsWith(`${base}/`) ? resumeHref : `${base}/${s.firstEpisode}`;
          const inner = (
            <>
              <span className="v-card-img" style={{ display: "block" }}>
                {poster.src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
                  <img {...poster} sizes={`auto, ${POSTER_ROW_SIZES}`} alt="" width={342} height={513} loading="lazy" decoding="async" />
                ) : (
                  <span className="v-card-ph">{label(s)}</span>
                )}
                {href && <span className="v-card-play" aria-hidden="true"><PlayIcon size={22} /></span>}
              </span>
              <span className="v-card-title">{s.name || label(s)}</span>
              <span className="v-card-sub">{s.upcomingCount > 0 ? `${s.episodeCount - s.upcomingCount} available · ${s.upcomingCount} coming soon` : `${s.episodeCount} ${s.episodeCount === 1 ? "episode" : "episodes"}`}</span>
              {!href && s.upcomingCount > 0 && s.airDate && <span className="v-card-sub">From {dateText(s.airDate)}</span>}
            </>
          );
          return (
            <li key={s.id}>
              {href ? (
                <PlayLink href={href} className="v-card" aria-label={`Play ${label(s)}`}>{inner}</PlayLink>
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
