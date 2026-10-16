"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches the surrounding server page on an interval (paused while the tab is hidden). */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
