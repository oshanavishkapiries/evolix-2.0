import Link from "next/link";
import { imageUrl } from "@/lib/images";
import { PlayIcon } from "./icons";
import { Swap } from "./motion";
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

export function Seasons({ show }: { show: ShowDetail }) {
  const { seasons, selected, episodes } = show;
  if (!selected) {
    return (
      <section className="v-section" aria-labelledby="seasons-h">
        <h2 id="seasons-h">Seasons</h2>
        <p className="v-muted">No episodes available yet.</p>
      </section>
    );
  }
  const label = (s: (typeof seasons)[number]) => (s.seasonNumber === 0 ? "Specials" : `Season ${s.seasonNumber}`);
  return (
    <>
      <section className="v-section" aria-labelledby="seasons-h">
        <h2 id="seasons-h">Seasons</h2>
        <ul className="v-seasons">
          {seasons.map((s) => {
            const poster = imageUrl(s.posterPath ?? show.posterPath, "w342");
            return (
              <li key={s.id}>
                <Link href={`/tv/${show.id}?season=${s.seasonNumber}`} className="v-card" aria-current={s.id === selected.id} replace scroll={false} prefetch={false}>
                  <span className="v-card-img" style={{ display: "block" }}>
                    {poster ? (
                      // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
                      <img src={poster} alt="" width={342} height={513} loading="lazy" decoding="async" />
                    ) : (
                      <span className="v-card-ph">{label(s)}</span>
                    )}
                  </span>
                  <span className="v-card-title">{s.name && s.seasonNumber !== 0 && s.name !== label(s) ? s.name : label(s)}</span>
                  <span className="v-card-sub">{s.episodeCount} {s.episodeCount === 1 ? "episode" : "episodes"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="v-section" aria-labelledby="episodes-h">
        <div className="v-season-head">
          <h2 id="episodes-h">Episodes <span className="v-muted">· {label(selected)}</span></h2>
          {selected.airDate && <span className="v-muted" style={{ fontSize: ".85rem" }}>{dateText(selected.airDate)}</span>}
        </div>
        {selected.overview && <p className="v-muted v-season-overview">{selected.overview}</p>}
        <Swap k={selected.id}>
        {episodes.length ? (
          <ul className="v-episodes">
            {episodes.map((ep) => (
              <li key={ep.id}>
                <EpisodeRow showId={show.id} seasonNumber={selected.seasonNumber} ep={ep} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="v-muted">No episodes in this season yet.</p>
        )}
        </Swap>
      </section>
    </>
  );
}
