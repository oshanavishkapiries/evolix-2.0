import Link from "next/link";
import type { WatchSource, WatchSubtitle } from "@/lib/viewer/watch";
import { EmbedFrame } from "./embed-frame";
import type { PauseInfo } from "./player-impl";
import type { ReportTarget } from "./report-button";
import { WatchPlayer } from "./watch-player";
import { WatchShell } from "./watch-shell";

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
  /** Backdrop and details shown while the video is paused. */
  info?: PauseInfo;
  report?: ReportTarget;
};

export function WatchView({ heading, sub, backHref, backLabel, basePath, sources, subtitles, selected, nav, side, track, startAt, info, report }: Props) {
  const sourcesPanel =
    sources.length > 0 ? (
      <>
        <h2>Sources</h2>
        <ul className="v-sources">
          {sources.map((s) => (
            <li key={s.id}>
              <Link href={`${basePath}?source=${s.id}`} className="v-source" aria-current={s.id === selected?.id} replace prefetch={false}>
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
      </>
    ) : undefined;

  return (
    <WatchShell
      title={sub ? `${heading} (${sub})` : heading}
      backHref={backHref}
      backLabel={backLabel}
      embed={selected?.kind === "embed"}
      sources={sourcesPanel}
      report={report}
      episodes={nav || side ? <>{side}{nav}</> : undefined}
    >
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
          info={info}
        />
      )}
    </WatchShell>
  );
}
