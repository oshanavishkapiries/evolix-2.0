"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { detectDevice, GATE_ATTR, gateExempt, isInstalled } from "@/lib/client/device";
import { InstallDemo, type DemoPlatform } from "./install-demo";
import "./pwa-gate.css";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const noSubscribe = () => () => {};
/** Browser-only value that renders as `false` on the server and during hydration. */
const useBrowser = (read: () => boolean) => useSyncExternalStore(noSubscribe, read, () => false);

const gateOff = process.env.NEXT_PUBLIC_PWA_GATE === "off";

const ShareGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
);

/**
 * Registers the service worker and, on phones and tablets that are not running the installed app,
 * covers the whole site with an install screen. There is no way to dismiss it: the site is only
 * usable from the home-screen app. Desktop browsers and /admin are untouched.
 */
export function PwaGate() {
  const pathname = usePathname();
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [done, setDone] = useState(false);
  const needs = useBrowser(() => !gateOff && detectDevice() !== "desktop" && !isInstalled() && !gateExempt(pathname));
  const ipad = useBrowser(() => /iPad/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  const iphone = useBrowser(() => /iPhone|iPod/i.test(navigator.userAgent));
  const platform: DemoPlatform = iphone ? "iphone" : ipad ? "ipad" : "android";

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setDone(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (needs) root.setAttribute(GATE_ATTR, "");
    else root.removeAttribute(GATE_ATTR);
  }, [needs]);

  if (!needs) return null;

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setDone(true);
    setPrompt(null);
  };

  return (
    <div className="pwa-gate" role="dialog" aria-modal="true" aria-labelledby="pwa-title">
      <div className="pwa-card">
        <p className="pwa-brand">evolix</p>
        <h1 id="pwa-title">{done ? "Evolix is installed" : "Install Evolix to continue"}</h1>
        {done ? (
          <p className="pwa-text">Close this tab and open <strong>Evolix</strong> from your home screen or app list.</p>
        ) : (
          <>
            <p className="pwa-text">On phones and tablets, Evolix works as an app. Install it to start watching.</p>
            {prompt && (
              <button type="button" className="pwa-btn" onClick={install}>Install Evolix</button>
            )}
            {prompt && <p className="pwa-or">or install it from your browser menu</p>}
            <div className="pwa-how">
              <InstallDemo platform={platform} />
              {platform === "android" ? (
                <ol className="pwa-steps">
                  <li>Open your browser menu <strong>⋮</strong></li>
                  <li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong></li>
                  <li>Confirm, then open Evolix from your home screen</li>
                </ol>
              ) : (
                <ol className="pwa-steps">
                  <li>Tap the Share button <ShareGlyph /> {platform === "ipad" ? "at the top" : "at the bottom"}</li>
                  <li>Choose <strong>Add to Home Screen</strong></li>
                  <li>Tap <strong>Add</strong>, then open Evolix from your home screen</li>
                </ol>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
