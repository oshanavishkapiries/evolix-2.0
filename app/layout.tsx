import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { GATE_SCRIPT } from "@/lib/client/device";
import { PwaGate } from "./_components/pwa-gate";
import "./globals.css";

export const metadata: Metadata = {
  title: "Evolix 2.0",
  description: "Family media library",
  appleWebApp: { capable: true, title: "Evolix", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#161616" };

const gateOff = process.env.NEXT_PUBLIC_PWA_GATE === "off";

// Brand preloader: shown once per browser session. Runs before paint so a repeat visit never flashes it.
const INTRO_SCRIPT = `(function(){var d=document.documentElement;if(/^\\/(?:login|register|forgot-password|reset-password|verify-email|admin)(?:\\/|$)/.test(location.pathname)){d.classList.add("intro-done");return}try{if(sessionStorage.getItem("evolix-intro")){d.classList.add("intro-done");return}sessionStorage.setItem("evolix-intro","1")}catch(e){}var start=Date.now(),out=false;function fade(){if(out)return;out=true;setTimeout(function(){d.classList.add("intro-out");setTimeout(function(){d.classList.add("intro-done")},500)},Math.max(0,300-(Date.now()-start)))}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",fade,{once:true});else fade();setTimeout(fade,700);setTimeout(function(){d.classList.add("intro-done")},1200)})()`;

// Inline (not in globals.css) so the preloader is styled before any stylesheet loads, and cannot be lost by CSS bundling.
const INTRO_CSS = `.intro{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:#0b0b0b;transition:opacity .5s ease}.intro img{width:min(220px,55vw);height:auto}html.intro-out .intro{opacity:0;pointer-events:none}html.intro-done .intro{display:none}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: INTRO_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />
        {!gateOff && <script dangerouslySetInnerHTML={{ __html: GATE_SCRIPT }} />}
      </head>
      <body>
        <div className="intro" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, must paint before hydration */}
          <img src="/svg/evolix.svg" alt="" width={220} height={65} />
        </div>
        {children}
        <Suspense fallback={null}>
          <PwaGate />
        </Suspense>
      </body>
    </html>
  );
}
