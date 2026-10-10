import Link from "next/link";
import { imageUrl } from "@/lib/images";
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
        <h2 id="seasons-h">Episodes</h2>
        <p className="v-muted">No episodes available yet.</p>
      </section>
    );
  }
  const poster = imageUrl(selected.posterPath, "w185");
  const label = (s: (typeof seasons)[number]) => (s.seasonNumber === 0 ? "Specials" : `Season ${s.seasonNumber}`);
  return (
    <section className="v-section" aria-labelledby="seasons-h">
      <h2 id="seasons-h">Episodes</h2>
      {seasons.length > 1 && (
        <nav className="v-tabs" aria-label="Seasons">
          {seasons.map((s) => (
            <Link
              key={s.id}
              href={`/tv/${show.id}?season=${s.seasonNumber}`}
              aria-current={s.id === selected.id}
              replace
              scroll={false}
            >
              {label(s)}
            </Link>
          ))}
        </nav>
      )}
      <div className="v-season-info">
        {poster && (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
          <img src={poster} alt={`${label(selected)} poster`} width={185} height={278} loading="lazy" decoding="async" />
        )}
        <div>
          <h3>{selected.name || label(selected)}</h3>
          <p className="v-muted" style={{ fontSize: ".8rem" }}>
            {[dateText(selected.airDate), `${episodes.length} ${episodes.length === 1 ? "episode" : "episodes"}`].filter(Boolean).join(" · ")}
          </p>
          {selected.overview && <p className="v-muted" style={{ marginTop: ".5rem", maxWidth: "60ch", fontSize: ".9rem" }}>{selected.overview}</p>}
        </div>
      </div>
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
    </section>
  );
}
