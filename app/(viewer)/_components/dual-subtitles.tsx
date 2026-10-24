"use client";

import { useActiveTextCues, useMediaPlayer, useMediaState, type TextTrack } from "@vidstack/react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { WatchSubtitle } from "@/lib/viewer/watch";
import { PENDING_ID } from "./sinhala-subtitles";
import { styleVars, type SubStyle } from "./subtitle-style";
import { applyTiming, cueText, loadTiming } from "./subtitle-timing";

export type SubtitleSlot = 0 | 1;
export type SubtitleSelection = [string | null, string | null];
export type SubtitleStyles = [SubStyle, SubStyle];

/** Track loading is an external player event, including when the second track fails independently. */
export function useSubtitleStatus(track: TextTrack | null) {
  const subscribe = useCallback((onChange: () => void) => {
    if (!track) return () => {};
    track.addEventListener("load-start", onChange);
    track.addEventListener("load", onChange);
    track.addEventListener("error", onChange);
    return () => {
      track.removeEventListener("load-start", onChange);
      track.removeEventListener("load", onChange);
      track.removeEventListener("error", onChange);
    };
  }, [track]);
  return useSyncExternalStore(subscribe, () => track?.readyState ?? 0, () => 0);
}

// Keep the same pair when changing quality, without carrying it into another title.
const remembered = new Map<string, SubtitleSelection>();

/** Two fixed slots enforce the limit and prevent the same track appearing twice. */
export function selectSubtitle(current: SubtitleSelection, slot: SubtitleSlot, id: string | null): SubtitleSelection {
  if ((slot !== 0 && slot !== 1) || (id && current[slot === 0 ? 1 : 0] === id)) return current;
  const next: SubtitleSelection = [current[0], current[1]];
  next[slot] = id;
  return next;
}

export function useDualSubtitleSelection({ mediaKey, subtitles, defaultId, generatedTrack, requestSinhala }: {
  mediaKey: string;
  subtitles: WatchSubtitle[];
  defaultId?: string;
  generatedTrack: WatchSubtitle | null;
  requestSinhala: () => void;
}) {
  const [selected, setSelected] = useState<SubtitleSelection>(() => {
    const saved = remembered.get(mediaKey);
    return saved ? saved.map((id) => subtitles.some((s) => s.id === id) ? id : null) as SubtitleSelection : [defaultId ?? null, null];
  });
  const [pendingSlot, setPendingSlot] = useState<SubtitleSlot | null>(null);
  // Resolve a requested translation only in its original slot. Changing that slot cancels auto-selection.
  const selection = useMemo(() => pendingSlot !== null && generatedTrack
    ? selectSubtitle(selected, pendingSlot, generatedTrack.id)
    : selected, [selected, pendingSlot, generatedTrack]);
  const choices: SubtitleSelection = [...selection];
  if (pendingSlot !== null && !generatedTrack) choices[pendingSlot] = PENDING_ID;

  useEffect(() => {
    remembered.set(mediaKey, selection);
    if (remembered.size > 100) remembered.delete(remembered.keys().next().value!);
  }, [mediaKey, selection]);

  const select = (slot: SubtitleSlot, id: string | null) => {
    const other = slot === 0 ? 1 : 0;
    if (id && (choices[other] === id || selection[other] === id)) return;
    if (id && !subtitles.some((s) => s.id === id)) return;
    if (id === PENDING_ID) {
      setPendingSlot(slot);
      requestSinhala();
    } else {
      setSelected(selectSubtitle(selection, slot, id));
      if (pendingSlot === slot) setPendingSlot(null);
    }
  };

  return { selection, choices, select };
}

/** Vidstack permits one showing track. Hidden tracks still load and update cues, so render both ourselves. */
export function DualSubtitles({ selection, styles }: { selection: SubtitleSelection; styles: SubtitleStyles }) {
  const player = useMediaPlayer();
  const tracks = useMediaState("textTracks");
  useEffect(() => {
    if (!player) return;
    const sync = () => {
      for (const track of player.textTracks) {
        if (track.kind !== "subtitles" && track.kind !== "captions") continue;
        const mode = selection.includes(track.id) ? "hidden" : "disabled";
        if (track.mode !== mode) track.setMode(mode);
      }
    };
    sync();
    player.textTracks.addEventListener("mode-change", sync);
    return () => player.textTracks.removeEventListener("mode-change", sync);
  }, [player, tracks, selection]);

  return (
    <div className="v-dual-captions" aria-label="Dual Subtitles">
      {selection.map((id, slot) => {
        const track = tracks.find((t) => t.id === id);
        return track ? <SubtitleLine key={`${slot}-${id}`} track={track} slot={slot as SubtitleSlot} style={styles[slot]} /> : null;
      })}
    </div>
  );
}

function SubtitleLine({ track, slot, style }: { track: TextTrack; slot: SubtitleSlot; style: SubStyle }) {
  const player = useMediaPlayer();
  const cues = useActiveTextCues(track);
  useEffect(() => {
    const apply = () => applyTiming(track, loadTiming(track.id), player?.state.currentTime ?? 0);
    if (track.readyState === 2) apply();
    track.addEventListener("load", apply);
    return () => track.removeEventListener("load", apply);
  }, [track, player]);

  return (
    <div className="v-dual-track" data-slot={slot} data-track-id={track.id} aria-label={track.label} style={styleVars(style)}>
      {cues.map((cue, i) => <span key={i}>{cueText(cue)}</span>)}
    </div>
  );
}
