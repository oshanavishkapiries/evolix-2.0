import { audioLabel } from "@/lib/audio";
import { imageSrcSet, POSTER_ROW_SIZES, POSTER_GRID_SIZES, LANDSCAPE_ROW_SIZES } from "@/lib/images";
import { detailHref, yearOf } from "@/lib/viewer/format";
import type { Card } from "@/lib/viewer/catalog";
import { BookmarkToggle } from "./bookmarks";
import { CardLink } from "./card-link";
import { PlayIcon } from "./icons";

export type CardVariant = "poster" | "landscape";

/** Plex-style card: image with a light hover, title and meta underneath (spec §5, Q15). */
export function MediaCard({ item, variant = "poster", badge = false, meta, logo = false, priority = false, grid = false, fetchPriority = "auto" }: { item: Card; variant?: CardVariant; badge?: boolean; meta?: string; priority?: boolean; grid?: boolean; fetchPriority?: "high" | "auto"; /** Overlay the title logo on landscape cards. */ logo?: boolean }) {
  const landscape = variant === "landscape";
  const image = imageSrcSet(landscape ? item.backdropPath ?? item.posterPath : item.posterPath, landscape && item.backdropPath ? "backdrop" : "poster", landscape ? 780 : 342);
  const sizes = landscape ? LANDSCAPE_ROW_SIZES : grid ? POSTER_GRID_SIZES : POSTER_ROW_SIZES;
  const logoImage = imageSrcSet(landscape && logo ? item.logoPath : null, "logo", 300);
  const sub = meta ?? [yearOf(item.date), badge ? (item.kind === "movie" ? "Movie" : "TV Show") : ""].filter(Boolean).join(" · ");
  const dubs = (item.dubs ?? []).map((c) => audioLabel(c) && `${audioLabel(c)} dub`).filter(Boolean).join(" · ");
  return (
    <div className="v-card" data-variant={variant}>
      <CardLink href={detailHref(item.kind, item.id)} className="v-card-link" morphId={landscape ? undefined : item.id}>
        <div className="v-card-img">
          {image.src ? (
            // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, sizes picked per use
            <img {...image} sizes={priority ? sizes : `auto, ${sizes}`} alt="" width={landscape ? 780 : 342} height={landscape ? 439 : 513} loading={priority ? "eager" : "lazy"} fetchPriority={fetchPriority} decoding="async" />
          ) : (
            <span className="v-card-ph">{item.title}</span>
          )}
          {logoImage.src && (
            <span className="v-card-logo" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN */}
              <img {...logoImage} sizes="auto, (max-width: 47.99rem) 40vw, 240px" alt="" loading="lazy" decoding="async" />
            </span>
          )}
          <span className="v-card-play" aria-hidden="true"><PlayIcon size={18} /></span>
        </div>
        <span className="v-card-title">{item.title}</span>
        {sub && <span className="v-card-sub">{sub}</span>}
        {dubs && <span className="v-card-dub">{dubs}</span>}
      </CardLink>
      <BookmarkToggle kind={item.kind} id={item.id} title={item.title} />
    </div>
  );
}
