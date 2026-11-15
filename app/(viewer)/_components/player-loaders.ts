"use client";

let player: Promise<typeof import("./player-impl")> | undefined;
let hls: Promise<typeof import("hls.js")> | undefined;

export function loadPlayer() {
  return player ??= import("./player-impl").catch((error) => {
    player = undefined;
    throw error;
  });
}

export function warmHls() {
  return hls ??= import("hls.js").catch((error) => {
    hls = undefined;
    throw error;
  });
}
