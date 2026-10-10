import Link from "next/link";
import type { WatchSource, WatchSubtitle } from "@/lib/viewer/watch";
import { BackIcon } from "./icons";
import { NavMarker } from "./nav-marker";
import { EmbedFrame } from "./embed-frame";
import { WatchPlayer } from "./watch-player";

/** Selected source from ?source=<id>; falls back to the first (lowest sortOrder). */
export const pickSource = (sources: WatchSource[], id: string | undefined) =>
  sources.find((s) => s.id === id) ?? sources[0] ?? null;

type Props = {
  heading: string;
  sub?: string;
  backHref: string;
  backLabel: string;
  /** Page path without query; source links append ?source=. */
  basePath: string;
  sources: WatchSource[];
  subtitles: WatchSubtitle[];
  selected: WatchSource | null;
  nav?: React.ReactNode;
  side?: React.ReactNode;
  /** Progress tracking target and resume position (direct/HLS sources only). */
  track?: { kind: "movie" | "episode"; id: string };
  startAt?: number;
};

export function WatchView({ heading, sub, backHref, backLabel, basePath, sources, subtitles, selected, nav, side, track, startAt }: Props) {
  return (
    <div className="v-watch">
      <NavMarker active="watch" />
      <div className="v-watch-head">
        <Link href={backHref} className="v-back"><BackIcon /> {backLabel}</Link>
        <h1>{heading}</h1>
        {sub && <span className="v-muted">{sub}</span>}
      </div>

      <div className="v-player-wrap">
        {!selected ? (
          <div className="v-player-msg" role="status">
            <strong>No sources available yet</strong>
            <p className="v-muted">This title has no playable source right now. Check back later.</p>
            <Link href={backHref} className="v-btn">{backLabel}</Link>
          </div>
        ) : selected.kind === "embed" ? (
          <EmbedFrame key={selected.id} url={selected.url} title={heading} />
        ) : (
          <WatchPlayer
            title={heading}
            source={{ id: selected.id, kind: selected.kind, url: selected.url }}
            subtitles={subtitles}
            track={track}
            startAt={startAt}
          />
        )}
      </div>

      <div className="v-watch-cols">
        <div>
          {sources.length > 0 && (
            <section id="sources" aria-labelledby="sources-h">
              <h2 id="sources-h" style={{ fontSize: "1.05rem", marginBottom: ".5rem" }}>Sources</h2>
              <ul className="v-sources">
                {sources.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`${basePath}?source=${s.id}`}
                      className="v-source"
                      aria-current={s.id === selected?.id}
                      replace
                      prefetch={false}
                    >
                      {s.label}
                      {s.quality && <small>{s.quality}</small>}
                    </Link>
                  </li>
                ))}
              </ul>
              {subtitles.length > 0 && selected?.kind !== "embed" && (
                <p className="v-muted" style={{ fontSize: ".8rem", marginTop: ".75rem" }}>
                  Subtitles: {subtitles.map((s) => s.label).join(", ")}. Use the captions button in the player.
                </p>
              )}
              {selected?.kind === "embed" && (
                <p className="v-muted" style={{ fontSize: ".8rem", marginTop: ".75rem" }}>
                  Embedded players handle their own subtitles.
                </p>
              )}
            </section>
          )}
          {nav}
        </div>
        {side && <aside className="v-watch-side">{side}</aside>}
      </div>
    </div>
  );
}
