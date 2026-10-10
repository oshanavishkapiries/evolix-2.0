"use client";

import { useEffect, useRef, useState } from "react";
import { ShareIcon } from "./icons";

/**
 * Tints the detail background from the poster (spec §6.4, Q4): draws a tiny copy to a canvas,
 * averages the saturated pixels, clamps the lightness and sets --v-tint on the page. TMDB's
 * image CDN sends CORS headers; any failure just leaves the neutral default.
 */
export function PosterTint({ src }: { src: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const host = ref.current?.closest<HTMLElement>(".v-detail");
    if (!src || !host) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 24;
        c.height = 36;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const { data } = ctx.getImageData(0, 0, c.width, c.height);
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [pr, pg, pb] = [data[i], data[i + 1], data[i + 2]];
          const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
          const weight = 1 + ((max - min) / 255) * 6; // favour saturated pixels over greys
          r += pr * weight; g += pg * weight; b += pb * weight; w += weight;
        }
        host.style.setProperty("--v-tint", toTint(r / w, g / w, b / w));
        host.dataset.tinted = "true";
      } catch {}
    };
    img.src = src;
  }, [src]);
  return <span ref={ref} hidden />;
}

/** Keeps the hue, caps saturation and pins lightness so text stays readable on any poster. */
function toTint(r: number, g: number, b: number) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h = 0;
  const d = max - min;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = Math.round(h * 60 + 360) % 360;
  }
  const l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return `hsl(${h} ${Math.round(Math.min(s, 0.55) * 100)}% 22%)`;
}

/** Overview clamped to 3 lines with a "More" toggle (only shown when it actually overflows). */
export function Overview({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 2);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="v-detail-overview">
      <p ref={ref} data-open={open}>{text}</p>
      {(overflows || open) && (
        <button type="button" className="v-more-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Less" : "More"} <span aria-hidden="true">⌄</span>
        </button>
      )}
    </div>
  );
}

/** Web Share API with a copy-link fallback. */
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) return await navigator.share({ title, url });
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }
  return (
    <button type="button" className="v-round" onClick={share} aria-label="Share" title="Share">
      <ShareIcon size={20} />
      {copied && <span className="v-toast" role="status">Link copied</span>}
    </button>
  );
}
