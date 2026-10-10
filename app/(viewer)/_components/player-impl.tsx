"use client";

import "vidstack/player/styles/default/theme.css";
import "vidstack/player/styles/default/layouts/video.css";
import { MediaPlayer, MediaProvider, Track, type MediaProviderAdapter } from "@vidstack/react";
import { defaultLayoutIcons, DefaultVideoLayout } from "@vidstack/react/player/layouts/default";
import { isHLSProvider } from "vidstack";
import { useState } from "react";
import type { WatchSource, WatchSubtitle } from "@/lib/viewer/watch";

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  ogg: "video/ogg",
  mov: "video/mp4",
  mkv: "video/webm",
};

/** Explicit type so extension-less direct URLs still play; HLS is always m3u8. */
function sourceType(kind: WatchSource["kind"], url: string) {
  if (kind === "hls") return "application/x-mpegurl" as const;
  const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "m3u8") return "application/x-mpegurl" as const;
  return (MIME_BY_EXT[ext] ?? "video/mp4") as "video/mp4";
}

const isEnglish = (lang: string) => /^en(-|_|$)/i.test(lang.trim()) || lang.trim().toLowerCase() === "english";

export default function PlayerImpl({
  title,
  source,
  subtitles,
}: {
  title: string;
  source: Pick<WatchSource, "kind" | "url">;
  subtitles: WatchSubtitle[];
}) {
  const [failed, setFailed] = useState(false);
  const insecure = typeof window !== "undefined" && window.location.protocol === "https:" && source.url.startsWith("http:");
  const defaultSub = subtitles.find((s) => isEnglish(s.language))?.id;

  if (failed || insecure) {
    return (
      <div className="v-player-msg" role="alert">
        <strong>This source could not be played</strong>
        <p className="v-muted">
          {insecure
            ? "This source is not served over HTTPS, so the browser blocks it on this page."
            : "It may be offline or in a format your browser cannot play."}
        </p>
        <a href="#sources" className="v-btn v-btn-primary">Try another source</a>
      </div>
    );
  }

  return (
    <MediaPlayer
      title={title}
      src={{ src: source.url, type: sourceType(source.kind, source.url) }}
      playsInline
      onProviderChange={(provider: MediaProviderAdapter | null) => {
        // Bundle hls.js ourselves (lazy chunk) instead of letting Vidstack fetch it from a CDN.
        if (isHLSProvider(provider)) provider.library = () => import("hls.js");
      }}
      onError={() => setFailed(true)}
    >
      <MediaProvider>
        {subtitles.map((s) => (
          <Track
            key={s.id}
            src={s.url}
            kind="subtitles"
            type={s.format}
            label={s.label}
            lang={s.language}
            default={s.id === defaultSub}
          />
        ))}
      </MediaProvider>
      <DefaultVideoLayout icons={defaultLayoutIcons} noScrubGesture={false} />
    </MediaPlayer>
  );
}
