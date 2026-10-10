import Link from "next/link";
import { imageUrl } from "@/lib/images";
import type { ContinueItem } from "@/lib/viewer/library";
import { PlayIcon } from "./icons";
import { ScrollRow } from "./scroll-row";

/** "Continue Watching": cards link straight into the player and show how far along the user is. */
export function ContinueRow({ items }: { items: ContinueItem[] }) {
  if (!items.length) return null;
  return (
    <section className="v-row v-continue" aria-label="Continue watching">
      <div className="v-row-head">
        <h2>Continue watching</h2>
      </div>
      <ScrollRow label="Continue watching">
        {items.map((it) => {
          const src = imageUrl(it.posterPath, "w342");
          return (
            <li key={it.key}>
              <div className="v-card">
                <Link href={it.href} className="v-card-link" prefetch={false} aria-label={`Resume ${it.title}${it.label ? ` ${it.label}` : ""}`}>
                  <div className="v-card-img">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
                      <img src={src} alt="" width={342} height={513} loading="lazy" decoding="async" />
                    ) : (
                      <span className="v-card-ph">{it.title}</span>
                    )}
                    <span className="v-card-hover" aria-hidden="true">
                      <span className="v-card-play"><PlayIcon size={24} /></span>
                    </span>
                    <span className="v-card-info">
                      <span className="v-card-title">{it.title}</span>
                      {it.label && <span className="v-card-label">{it.label}</span>}
                    </span>
                    {it.percent > 0 && (
                      <span className="v-progress" role="progressbar" aria-valuenow={it.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Watched">
                        <span style={{ width: `${it.percent}%` }} />
                      </span>
                    )}
                  </div>
                </Link>
              </div>
            </li>
          );
        })}
      </ScrollRow>
    </section>
  );
}
