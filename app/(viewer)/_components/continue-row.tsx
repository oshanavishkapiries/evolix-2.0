import Link from "next/link";
import { imageUrl } from "@/lib/images";
import type { ContinueItem } from "@/lib/viewer/library";
import { PlayIcon } from "./icons";
import { ScrollRow } from "./scroll-row";

const leftText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}hr ${m % 60}min left` : `${m}min left`);

/** "Continue Watching": landscape cards that link straight into the player, with progress. */
export function ContinueRow({ items }: { items: ContinueItem[] }) {
  if (!items.length) return null;
  return (
    <ScrollRow label="Continue watching" variant="landscape" head={<><h2>Continue Watching</h2><p>Pick up where you left off</p></>}>
      {items.map((it) => {
        const src = imageUrl(it.backdropPath ?? it.posterPath, "w780");
        const sub = [it.label, it.leftMinutes ? leftText(it.leftMinutes) : it.percent === 0 ? "Up next" : ""].filter(Boolean).join(" · ");
        return (
          <li key={it.key}>
            <div className="v-card" data-variant="landscape">
              <Link href={it.href} className="v-card-link" prefetch={false} aria-label={`Resume ${it.title}${it.label ? ` ${it.label}` : ""}`}>
                <div className="v-card-img">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
                    <img src={src} alt="" width={780} height={439} loading="lazy" decoding="async" />
                  ) : (
                    <span className="v-card-ph">{it.title}</span>
                  )}
                  <span className="v-card-play" aria-hidden="true"><PlayIcon size={18} /></span>
                  {it.percent > 0 && (
                    <span className="v-progress" role="progressbar" aria-valuenow={it.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Watched">
                      <span style={{ width: `${it.percent}%` }} />
                    </span>
                  )}
                </div>
                <span className="v-card-title">{it.title}</span>
                {sub && <span className="v-card-sub">{sub}</span>}
              </Link>
            </div>
          </li>
        );
      })}
    </ScrollRow>
  );
}
