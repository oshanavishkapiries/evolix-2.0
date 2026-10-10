import type { Metadata } from "next";
import { BottomNav } from "./_components/bottom-nav";
import { ViewerNav } from "./_components/nav";
import "./viewer.css";

export const metadata: Metadata = {
  title: { template: "%s | Evolix", default: "Evolix" },
  robots: { index: false, follow: false },
};

export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="viewer">
      <a href="#main" className="v-skip">Skip to content</a>
      <ViewerNav />
      <main id="main">{children}</main>
      <footer className="v-footer">Evolix - private family library</footer>
      <BottomNav />
    </div>
  );
}
