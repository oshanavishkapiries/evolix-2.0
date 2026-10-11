import Link from "next/link";
import { audioLabel } from "@/lib/audio";
import type { WatchSource, WatchSubtitle } from "@/lib/viewer/watch";
import { AudioPicker } from "./audio-picker";
import { EmbedFrame } from "./embed-frame";
import type { PauseInfo } from "./player-impl";
import type { ReportTarget } from "./report-button";
import { WatchPlayer } from "./watch-player";
import { WatchShell } from "./watch-shell";

/** Dub languages of the title and the one being played (see chooseAudio). */
export type AudioState = { languages: string[]; active: string; fellBackFrom?: string | null };

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
  audio?: AudioState;
};

export function WatchView({ heading, sub, backHref, backLabel, basePath, sources, subtitles, selected, nav, side, track, startAt, info, report, audio }: Props) {
  const multi = audio && audio.languages.length > 1;
  const sourcesPanel =
    sources.length > 0 ? (
      <>
        {multi && <AudioPicker basePath={basePath} languages={audio.languages} active={audio.active} />}
        {audio?.fellBackFrom && (
          <p className="v-muted" style={{ fontSize: ".8rem", marginBottom: ".75rem" }}>
            No {audioLabel(audio.fellBackFrom) || audio.fellBackFrom} dub for this one, so {audioLabel(audio.active)} is playing.
          </p>
        )}
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
      audioLabel={multi ? `${audioLabel(audio.active)} dub` : undefined}
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
