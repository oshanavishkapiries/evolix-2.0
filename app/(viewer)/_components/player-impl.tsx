"use client";

import "vidstack/player/styles/default/theme.css";
import "vidstack/player/styles/default/layouts/video.css";
import { MediaPlayer, MediaProvider, Track, type MediaProviderAdapter } from "@vidstack/react";
import { defaultLayoutIcons, DefaultVideoLayout } from "@vidstack/react/player/layouts/default";
import { isHLSProvider } from "vidstack";
import { useEffect, useState } from "react";
import {
  pixeldrainId,
  pixeldrainInfoUrl,
  playbackCandidates,
  typeFromName,
  type PlayerType,
} from "@/lib/viewer/providers";
import type { WatchSource, WatchSubtitle } from "@/lib/viewer/watch";

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
  const [attempt, setAttempt] = useState(0);
  const [hint, setHint] = useState<PlayerType | null>(null);
  const pdId = pixeldrainId(source.url);

  // Pixeldrain links carry no extension; ask its info API for the real file type (best effort).
  useEffect(() => {
    if (!pdId) return;
    const ctrl = new AbortController();
    fetch(pixeldrainInfoUrl(pdId), { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { name?: string; mime_type?: string } | null) => {
        const t = info?.name ? typeFromName(info.name) : null;
        if (t) setHint(t);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [pdId]);

  const candidates = playbackCandidates(source.kind, source.url, hint);
  const current = candidates[Math.min(attempt, candidates.length - 1)];
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
      key={`${current.type}`}
      src={current}
      playsInline
      onProviderChange={(provider: MediaProviderAdapter | null) => {
        // Bundle hls.js ourselves (lazy chunk) instead of letting Vidstack fetch it from a CDN.
        if (isHLSProvider(provider)) provider.library = () => import("hls.js");
      }}
      onError={() => {
        if (attempt + 1 < candidates.length) setAttempt(attempt + 1);
        else setFailed(true);
      }}
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
