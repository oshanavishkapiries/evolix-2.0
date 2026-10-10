import Link from "next/link";
import { imageUrl } from "@/lib/images";
import { detailHref, yearOf } from "@/lib/viewer/format";
import type { Card } from "@/lib/viewer/catalog";
import { BookmarkToggle } from "./bookmarks";
import { PlayIcon } from "./icons";

export type CardVariant = "poster" | "landscape";

/** Plex-style card: image with a light hover, title and meta underneath (spec §5, Q15). */
export function MediaCard({ item, variant = "poster", badge = false, meta }: { item: Card; variant?: CardVariant; badge?: boolean; meta?: string }) {
  const landscape = variant === "landscape";
  const src = landscape ? imageUrl(item.backdropPath ?? item.posterPath, "w780") : imageUrl(item.posterPath, "w342");
  const sub = meta ?? [yearOf(item.date), badge ? (item.kind === "movie" ? "Movie" : "TV Show") : ""].filter(Boolean).join(" · ");
  return (
    <div className="v-card" data-variant={variant}>
      <Link href={detailHref(item.kind, item.id)} className="v-card-link" prefetch={false}>
        <div className="v-card-img">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, sizes picked per use
            <img src={src} alt="" width={landscape ? 780 : 342} height={landscape ? 439 : 513} loading="lazy" decoding="async" />
          ) : (
            <span className="v-card-ph">{item.title}</span>
          )}
          <span className="v-card-play" aria-hidden="true"><PlayIcon size={18} /></span>
        </div>
        <span className="v-card-title">{item.title}</span>
        {sub && <span className="v-card-sub">{sub}</span>}
      </Link>
      <BookmarkToggle kind={item.kind} id={item.id} title={item.title} />
    </div>
  );
}
