"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackIcon, CloseIcon, EpisodesIcon, SourcesIcon } from "./icons";
import { WATCH_PANEL_EVENT, type WatchPanelKey } from "./watch-panel-events";

type PanelKey = WatchPanelKey;
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
    document.body.setAttribute("data-v-watch", "");
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
    const onPanel = (e: Event) => setPanel((e as CustomEvent<PanelKey>).detail);
    window.addEventListener(WATCH_PANEL_EVENT, onPanel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    return () => {
      document.body.style.overflow = prev;
      document.body.removeAttribute("data-v-watch");
      clearTimeout(timer.current);
      window.removeEventListener(WATCH_PANEL_EVENT, onPanel);
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
        {embed && (
          <div className="v-watch-actions">
            {episodes && (
              <button type="button" className="v-bar-icon" aria-label="Episodes" onClick={() => toggle("episodes")}>
                <EpisodesIcon size={22} />
              </button>
            )}
            {sources && (
              <button type="button" className="v-bar-icon" aria-label="Sources" onClick={() => toggle("sources")}>
                <SourcesIcon size={22} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="v-watch-scrim" data-open={panel !== null} onClick={() => setPanel(null)} aria-hidden />

      {sources && (
        <Panel id="sources" title="Sources" open={panel === "sources"} onClose={() => setPanel(null)}>{sources}</Panel>
      )}
      {episodes && (
        <Panel id="episodes" title="Episodes" open={panel === "episodes"} onClose={() => setPanel(null)}>{episodes}</Panel>
      )}
    </div>
  );
}

function Panel({ id, title, open, onClose, children }: { id: string; title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  // Bring the playing episode into view when the panel opens.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => body.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "center", behavior: "smooth" }), 150);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <aside id={id} className="v-watch-panel" data-open={open} aria-hidden={!open} inert={!open} aria-label={title}>
      <header className="v-panel-head">
        <h2>{title}</h2>
        <button type="button" className="v-bar-icon" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          <CloseIcon size={20} />
        </button>
      </header>
      <div className="v-panel-body" ref={body}>{children}</div>
    </aside>
  );
}
