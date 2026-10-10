"use client";

import dynamic from "next/dynamic";
import type { WatchSource, WatchSubtitle } from "@/lib/viewer/watch";

// The player (and hls.js) is only fetched on the watch page, and only for direct/HLS sources.
const PlayerImpl = dynamic(() => import("./player-impl"), {
  ssr: false,
  loading: () => <div className="v-skel" style={{ position: "absolute", inset: 0, borderRadius: 0 }} aria-busy="true" aria-label="Loading player" />,
});

export function WatchPlayer(props: { title: string; source: Pick<WatchSource, "id" | "kind" | "url">; subtitles: WatchSubtitle[] }) {
  // key: switching source remounts the player so errors/state reset.
  return <PlayerImpl key={props.source.id} {...props} />;
}
