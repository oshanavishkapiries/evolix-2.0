"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { loadPlayer, warmHls } from "./player-loaders";

function warmPlayback() {
  void loadPlayer().catch(() => {});
  void warmHls().catch(() => {});
}

/** Warm playback code on intent without mounting a player or fetching media. */
export function PlayLink({ onPointerEnter, onFocus, onPointerDown, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      onPointerEnter={(event) => { warmPlayback(); onPointerEnter?.(event); }}
      onFocus={(event) => { warmPlayback(); onFocus?.(event); }}
      onPointerDown={(event) => { warmPlayback(); onPointerDown?.(event); }}
    />
  );
}
