"use client";

import { PlayButton, SeekButton } from "@vidstack/react";
import { defaultLayoutIcons } from "@vidstack/react/player/layouts/default";

const { PlayButton: PlayIcons, SeekButton: SeekIcons } = defaultLayoutIcons;

/** Seconds the centre skip buttons move. */
export const SKIP_SECONDS = 10;

/** Large play/pause for the middle of the video. Shown and hidden with the player controls. */
export function CenterPlayButton() {
  return (
    <PlayButton className="v-center-btn v-center-play" aria-label="Play or pause">
      <PlayIcons.Play className="vds-icon v-icon-play" />
      <PlayIcons.Pause className="vds-icon v-icon-pause" />
      <PlayIcons.Replay className="vds-icon v-icon-replay" />
    </PlayButton>
  );
}

export function CenterSkipButton({ forward }: { forward?: boolean }) {
  const Icon = forward ? SeekIcons.Forward : SeekIcons.Backward;
  return (
    <SeekButton className="v-center-btn v-center-skip" seconds={forward ? SKIP_SECONDS : -SKIP_SECONDS} aria-label={`${forward ? "Skip forward" : "Skip back"} ${SKIP_SECONDS} seconds`}>
      <Icon className="vds-icon" />
    </SeekButton>
  );
}
