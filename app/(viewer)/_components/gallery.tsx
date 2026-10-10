"use client";

import { useRef, useState } from "react";
import { imageUrl } from "@/lib/images";

/** Backdrop grid with a native <dialog> lightbox (Esc closes, click outside closes). */
export function Gallery({ paths, title }: { paths: string[]; title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const count = paths.length;
  if (!count) return null;

  const open = (i: number) => {
    setIndex(i);
    dialog.current?.showModal();
  };
  const step = (d: number) => setIndex((i) => (i + d + count) % count);

  return (
    <section className="v-section" aria-labelledby="gallery-h">
      <h2 id="gallery-h">Gallery</h2>
      <ul className="v-gallery">
        {paths.map((p, i) => (
          <li key={p}>
            <button type="button" onClick={() => open(i)} aria-label={`View image ${i + 1} of ${count}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN */}
              <img src={imageUrl(p, "w780") ?? ""} alt={`${title} backdrop ${i + 1}`} width={780} height={439} loading="lazy" decoding="async" />
            </button>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        className="v-lightbox"
        aria-label={`${title} gallery`}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN */}
        <img src={imageUrl(paths[index], "w1280") ?? ""} alt={`${title} backdrop ${index + 1}`} />
        <div className="v-lightbox-bar">
          <span aria-live="polite">{index + 1} / {count}</span>
          <span style={{ display: "flex", gap: ".5rem" }}>
            {count > 1 && (
              <>
                <button type="button" className="v-btn v-btn-sm" onClick={() => step(-1)}>Previous</button>
                <button type="button" className="v-btn v-btn-sm" onClick={() => step(1)}>Next</button>
              </>
            )}
            <button type="button" className="v-btn v-btn-sm" onClick={() => dialog.current?.close()}>Close</button>
          </span>
        </div>
      </dialog>
    </section>
  );
}
