"use client";

import { useEffect } from "react";
import { useInboxSummary, type ViewerInboxSeed } from "@/app/_components/support/unread";
import { useSeedBookmarks } from "./bookmarks";
import type { BookmarkIds } from "./bookmark-store";
import { useViewerAccount, type ViewerAccount } from "./app-chrome";

/** The streamed data slot seeds the existing providers without suspending the page or remounting its shell. */
export function ViewerSeedClient({ bookmarks, inbox, account }: { bookmarks: BookmarkIds; inbox: ViewerInboxSeed; account: ViewerAccount | null }) {
  const seedBookmarks = useSeedBookmarks();
  const seedInbox = useInboxSummary()?.seed;
  const seedAccount = useViewerAccount().seed;
  useEffect(() => {
    seedBookmarks?.(bookmarks);
    seedInbox?.(inbox);
    seedAccount(account);
  }, [bookmarks, inbox, account, seedBookmarks, seedInbox, seedAccount]);
  return null;
}
