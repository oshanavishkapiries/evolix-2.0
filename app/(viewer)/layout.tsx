import type { Metadata } from "next";
import { Noto_Sans } from "next/font/google";
import { AppChrome } from "./_components/app-chrome";
import { BookmarkProvider } from "./_components/bookmarks";
import { BottomNav } from "./_components/bottom-nav";
import { PREFS_SCRIPT } from "./_components/prefs";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/cards.css";
import "./styles/detail.css";
import "./viewer.css";

const font = Noto_Sans({ subsets: ["latin"], weight: ["400", "500", "700"], display: "swap", variable: "--v-font" });

export const metadata: Metadata = {
  title: { template: "%s | Evolix", default: "Evolix" },
  robots: { index: false, follow: false },
};

export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`viewer ${font.variable}`}>
      {/* Applies saved sidebar/card-size prefs before first paint. */}
      <script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />
      <a href="#main" className="v-skip">Skip to content</a>
      <AppChrome />
      <BookmarkProvider>
        <main id="main" className="v-main">{children}</main>
      </BookmarkProvider>
      <BottomNav />
    </div>
  );
}
