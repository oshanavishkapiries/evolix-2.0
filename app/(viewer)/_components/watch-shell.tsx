"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackIcon } from "./icons";

type PanelKey = "sources" | "episodes";
const IDLE_MS = 3000;

/** Full-screen player shell: close button, auto-hiding top bar and slide-over panels. */
export function WatchShell({
  title,
  backHref,
  backLabel,
  embed,
  sources,
  episodes,
  children,
}: {
  title: string;
  backHref: string;
  backLabel: string;
  /** Third-party iframes swallow pointer events, so the bar stays visible for them. */
  embed: boolean;
  sources?: React.ReactNode;
  episodes?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<PanelKey | null>(null);
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), IDLE_MS);
  }, []);

  useEffect(() => {
    timer.current = setTimeout(() => setIdle(true), IDLE_MS);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.fullscreenElement) return;
      if (panel) setPanel(null);
      else router.push(backHref);
    };
    // The player's "Try another source" link points at #sources.
    const onHash = () => {
      if (location.hash !== "#sources") return;
      history.replaceState(null, "", location.pathname + location.search);
      setPanel("sources");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(timer.current);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", onHash);
    };
  }, [backHref, panel, router]);

  const hidden = idle && !embed && !panel;
  const toggle = (k: PanelKey) => setPanel((p) => (p === k ? null : k));

  return (
    <div className="v-watch" data-idle={hidden} onPointerMove={wake} onPointerDown={wake} onKeyDown={wake}>
      <div className="v-player-wrap">{children}</div>

      <div className="v-watch-bar">
        <Link href={backHref} className="v-back" aria-label={`Close player, back to ${backLabel}`}>
          <BackIcon size={22} />
        </Link>
        <h1>{title}</h1>
        <div className="v-watch-actions">
          {episodes && (
            <button type="button" className="v-bar-btn" aria-expanded={panel === "episodes"} onClick={() => toggle("episodes")}>
              Episodes
            </button>
          )}
          {sources && (
            <button type="button" className="v-bar-btn" aria-expanded={panel === "sources"} onClick={() => toggle("sources")}>
              Sources
            </button>
          )}
          <Link href={backHref} className="v-bar-close" aria-label="Close player">✕</Link>
        </div>
      </div>

      {sources && (
        <aside id="sources" className="v-watch-panel" data-open={panel === "sources"} aria-hidden={panel !== "sources"} inert={panel !== "sources"}>
          {sources}
        </aside>
      )}
      {episodes && (
        <aside className="v-watch-panel" data-open={panel === "episodes"} aria-hidden={panel !== "episodes"} inert={panel !== "episodes"}>
          {episodes}
        </aside>
      )}
    </div>
  );
}
