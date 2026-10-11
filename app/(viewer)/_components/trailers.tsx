"use client";

import { useRef, useState } from "react";
import { isValidKey, TYPE_LABELS, type VideoSite, type VideoType } from "@/lib/videos";
import { CloseIcon, PlayIcon } from "./icons";
import { ScrollRow } from "./scroll-row";

type Video = { id: string; site: VideoSite; key: string; name: string; type: VideoType };

const embedUrl = (v: Video) =>
  v.site === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.key)}?autoplay=1&rel=0`
    : `https://player.vimeo.com/video/${encodeURIComponent(v.key)}?autoplay=1`;

const thumbUrl = (v: Video) => (v.site === "youtube" ? `https://i.ytimg.com/vi/${encodeURIComponent(v.key)}/hqdefault.jpg` : null);

/** Row of video cards; playing one opens a modal (nothing from YouTube/Vimeo is requested until then). */
export function Trailers({ videos }: { videos: Video[] }) {
  const list = videos.filter((v) => isValidKey(v.site, v.key));
  const dialog = useRef<HTMLDialogElement>(null);
  const [playing, setPlaying] = useState<Video | null>(null);
  if (!list.length) return null;

  const play = (v: Video) => {
    setPlaying(v);
    dialog.current?.showModal();
  };

  return (
    <div id="extras">
      <ScrollRow label="Extras" variant="video" head={<h2>Extras</h2>}>
        {list.map((v) => {
          const src = thumbUrl(v);
          return (
            <li key={v.id}>
              <button type="button" className="v-video" onClick={() => play(v)} aria-label={`Play ${v.name}`}>
                <span className="v-video-img">
                  {src && (
                    // eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnail CDN
                    <img src={src} alt="" width={480} height={360} loading="lazy" decoding="async" />
                  )}
                  <span className="v-video-tag">{TYPE_LABELS[v.type]}</span>
                  <span className="v-video-play" aria-hidden="true"><PlayIcon size={22} /></span>
                </span>
                <span className="v-video-name">{v.name}</span>
              </button>
            </li>
          );
        })}
      </ScrollRow>
      <dialog
        ref={dialog}
        className="v-modal"
        aria-label={playing?.name ?? "Video"}
        onClose={() => setPlaying(null)}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="v-modal-frame">
          {playing && (
            <iframe
              key={playing.id}
              src={embedUrl(playing)}
              title={playing.name}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
        </div>
        <div className="v-modal-bar">
          <span>{playing ? `${TYPE_LABELS[playing.type]}: ${playing.name}` : ""}</span>
          <button type="button" className="v-bar-icon" aria-label="Close video" onClick={() => dialog.current?.close()}>
            <CloseIcon size={20} />
          </button>
        </div>
      </dialog>
    </div>
  );
}
