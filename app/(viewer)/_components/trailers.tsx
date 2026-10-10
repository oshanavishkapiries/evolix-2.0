"use client";

import { useState } from "react";
import { isValidKey, TYPE_LABELS, type VideoSite, type VideoType } from "@/lib/videos";

type Video = { id: string; site: VideoSite; key: string; name: string; type: VideoType };

const embedUrl = (v: Video) =>
  v.site === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.key)}?autoplay=1&rel=0`
    : `https://player.vimeo.com/video/${encodeURIComponent(v.key)}?autoplay=1`;

const thumbUrl = (v: Video) => (v.site === "youtube" ? `https://i.ytimg.com/vi/${encodeURIComponent(v.key)}/hqdefault.jpg` : null);

function Thumb({ video }: { video: Video }) {
  const src = thumbUrl(video);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnail CDN
    <img src={src} alt="" width={480} height={360} loading="lazy" decoding="async" />
  ) : null;
}

/** Click-to-load player (nothing from YouTube/Vimeo is requested until play) plus thumbnails for the rest. */
export function Trailers({ videos }: { videos: Video[] }) {
  const list = videos.filter((v) => isValidKey(v.site, v.key));
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const current = list[index];
  if (!current) return null;

  return (
    <section className="v-section" id="trailers" aria-labelledby="videos-h">
      <h2 id="videos-h">Trailers &amp; videos</h2>
      <div className="v-video-frame">
        {loaded ? (
          <iframe
            key={current.id}
            src={embedUrl(current)}
            title={current.name}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button type="button" onClick={() => setLoaded(true)} aria-label={`Play ${current.name}`}>
            <Thumb video={current} />
            <span className="v-play-badge">
              <span aria-hidden="true">▶</span>
            </span>
          </button>
        )}
      </div>
      <p className="v-muted" style={{ marginTop: ".5rem", fontSize: ".9rem" }}>
        {TYPE_LABELS[current.type]}: {current.name}
      </p>
      {list.length > 1 && (
        <ul className="v-thumbs">
          {list.map((v, i) => (
            <li key={v.id}>
              <button
                type="button"
                className="v-thumb"
                aria-pressed={i === index}
                onClick={() => {
                  setIndex(i);
                  setLoaded(true);
                }}
              >
                <span className="v-thumb-img" style={{ display: "block" }}>
                  <Thumb video={v} />
                </span>
                <span className="v-thumb-name" style={{ display: "-webkit-box" }}>{v.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
