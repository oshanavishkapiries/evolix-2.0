"use client";

import dynamic from "next/dynamic";
import { loadPlayer } from "./player-loaders";
import { useEffect, useState } from "react";
import type { PauseInfo, ProgressTarget, QualityMenu } from "./player-impl";
import type { SinhalaTarget } from "./sinhala-subtitles";
import { notePlayerClosed } from "@/lib/client/error-reporter";
import type { WatchSource, WatchSubtitle } from "@/lib/viewer/watch";

// Playback links can warm the modules; mounting still waits for a live direct/HLS player.
const Skeleton = () => <div className="v-skel" style={{ position: "absolute", inset: 0, borderRadius: 0 }} aria-busy="true" aria-label="Loading player" />;
const PlayerImpl = dynamic(loadPlayer, { ssr: false, loading: Skeleton });

export function WatchPlayer(props: { title: string; source: Pick<WatchSource, "id" | "kind" | "url">; subtitles: WatchSubtitle[]; track?: ProgressTarget; startAt?: number; info?: PauseInfo; qualityMenu?: QualityMenu; sinhala?: SinhalaTarget; playerKey?: string }) {
  // key: switching source remounts the player so errors/state reset (playerKey lets a parent keep one across id changes).
  const { playerKey, ...rest } = props;
  // Cached pages stay alive while hidden: React runs their effect cleanups, and Vidstack destroys the player a tick
  // later. Rendering the player only while live means a page that comes back builds a fresh one instead of reusing a
  // destroyed instance (which throws "Cannot read properties of undefined (reading 'set')").
  const [live, setLive] = useState(false);
  useEffect(() => {
    // Intentional: this effect's setup/cleanup is the only signal that a cached page was shown or hidden again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLive(true);
    return () => {
      notePlayerClosed();
      setLive(false);
    };
  }, []);
  if (!live) return <Skeleton />;
  return <PlayerImpl key={playerKey ?? props.source.id} {...rest} />;
}
