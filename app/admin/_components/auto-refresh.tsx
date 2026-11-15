"use client";
import { useVisibleInterval } from "@/lib/client/use-visible-interval";

import { useRouter } from "next/navigation";

/** Re-fetches the surrounding server page on an interval (paused while the tab is hidden). */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useVisibleInterval(() => router.refresh(), seconds * 1000, false);
  return null;
}
