"use client";

import Link from "next/link";
import { AUDIO_COOKIE, audioLabel } from "@/lib/audio";

const remember = (code: string) => {
  document.cookie = `${AUDIO_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
};

/** Dub language choices; the pick is remembered so the next title or episode starts in it. */
export function AudioPicker({ basePath, languages, active }: { basePath: string; languages: string[]; active: string }) {
  return (
    <>
      <h2>Audio</h2>
      <ul className="v-sources v-audio">
        {languages.map((code) => (
          <li key={code}>
            <Link href={`${basePath}?lang=${code}`} className="v-source" aria-current={code === active} replace prefetch={false} onClick={() => remember(code)}>
              {audioLabel(code)} dub
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
