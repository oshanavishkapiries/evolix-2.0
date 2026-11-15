import { Suspense } from "react";
import { SupportUnreadProvider } from "@/app/_components/support/unread";
import "@/app/_components/support/support.css";
import type { Metadata } from "next";
import { font } from "@/app/fonts";
import { AnnouncementBanner, AnnouncementPopup, AnnouncementsProvider } from "./_components/announcements";
import { CardMorphHandler } from "./_components/morph-handler";
import { ViewerSeed } from "./_components/viewer-seed";
import { AppChrome, ViewerAccountProvider } from "./_components/app-chrome";
import { BookmarkProvider } from "./_components/bookmarks";
import { BottomNav } from "./_components/bottom-nav";
import { PREFS_SCRIPT } from "./_components/prefs";
import { TmdbPreconnect } from "./_components/tmdb-preconnect";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/cards.css";
import "./styles/detail.css";
import "./styles/components.css";
import "./styles/motion.css";

export const metadata: Metadata = {
  title: { template: "%s | Evolix", default: "Evolix" },
  robots: { index: false, follow: false },
};

export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`viewer ${font.variable}`}>
      <TmdbPreconnect />
      {/* Applies saved sidebar/card-size prefs before first paint. */}
      <script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />
      <a href="#main" className="v-skip">Skip to content</a>
      <ViewerAccountProvider>
        <SupportUnreadProvider initial={{ unreadSupport: { count: 0, latest: null }, announcements: { items: [], unread: 0 } }}>
          <AnnouncementsProvider>
            <AppChrome />
            <BookmarkProvider initial={{ movies: [], shows: [] }}>
              <Suspense fallback={null}><ViewerSeed /></Suspense>
              <CardMorphHandler />
              <main id="main" className="v-main">
                <AnnouncementBanner />
                <AnnouncementPopup />
                {children}
              </main>
            </BookmarkProvider>
          </AnnouncementsProvider>
          <BottomNav />
        </SupportUnreadProvider>
      </ViewerAccountProvider>
    </div>
  );
}
