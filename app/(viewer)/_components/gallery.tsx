"use client";

import { useEffect, useRef, useState } from "react";
import { imageUrl } from "@/lib/images";
import { ChevronIcon, CloseIcon } from "./icons";
import { ScrollRow } from "./scroll-row";

/** Backdrop row with a full-screen <dialog> lightbox (Esc closes, arrows step, click outside closes). */
export function Gallery({ paths, title }: { paths: string[]; title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const [isOpen, setOpen] = useState(false);
  const count = paths.length;

  useEffect(() => {
    if (!isOpen || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % count);
      else if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + count) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, count]);

  if (!count) return null;

  const open = (i: number) => {
    setIndex(i);
    setOpen(true);
    dialog.current?.showModal();
  };
  const step = (d: number) => setIndex((i) => (i + d + count) % count);

  return (
    <>
      <ScrollRow label="Gallery" variant="shot" head={<h2>Gallery</h2>}>
        {paths.map((p, i) => (
          <li key={p}>
            <button type="button" className="v-shot" onClick={() => open(i)} aria-label={`View image ${i + 1} of ${count}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN */}
              <img src={imageUrl(p, "w780") ?? ""} alt={`${title} backdrop ${i + 1}`} width={780} height={439} loading="lazy" decoding="async" />
            </button>
          </li>
        ))}
      </ScrollRow>
      <dialog
        ref={dialog}
        className="v-lightbox"
        aria-label={`${title} gallery`}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialog.current || (e.target as HTMLElement).dataset.close) dialog.current?.close();
        }}
      >
        {isOpen && (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
          <img key={index} src={imageUrl(paths[index], "w1280") ?? ""} alt={`${title} backdrop ${index + 1}`} data-close="1" />
        )}
        <button type="button" className="v-bar-icon v-lb-close" aria-label="Close gallery" onClick={() => dialog.current?.close()}>
          <CloseIcon size={22} />
        </button>
        {count > 1 && (
          <>
            <button type="button" className="v-bar-icon v-lb-prev" aria-label="Previous image" onClick={() => step(-1)}>
              <ChevronIcon dir="left" size={26} />
            </button>
            <button type="button" className="v-bar-icon v-lb-next" aria-label="Next image" onClick={() => step(1)}>
              <ChevronIcon dir="right" size={26} />
            </button>
          </>
        )}
        <span className="v-lb-count" aria-live="polite">{index + 1} / {count}</span>
      </dialog>
    </>
  );
}
