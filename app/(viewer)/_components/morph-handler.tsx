"use client";

import { useEffect } from "react";

/** Capture before Link navigates; names are unique even when a title appears in several rows. */
export function CardMorphHandler() {
  useEffect(() => {
    let clear: (() => void) | undefined;
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-card-morph]") : null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const img = link.querySelector<HTMLElement>(".v-card-img");
      if (!img || !link.dataset.cardMorph) return;
      clear?.();
      img.style.viewTransitionName = `poster-${link.dataset.cardMorph}`;
      img.style.setProperty("view-transition-class", "v-morph");
      const timer = window.setTimeout(() => clear?.(), 1000);
      clear = () => {
        window.clearTimeout(timer);
        img.style.viewTransitionName = "";
        img.style.removeProperty("view-transition-class");
        clear = undefined;
      };
    };
    document.addEventListener("click", onClick, true);
    return () => { document.removeEventListener("click", onClick, true); clear?.(); };
  }, []);
  return null;
}
