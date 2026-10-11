import { audioLabel } from "@/lib/audio";
import { imageUrl } from "@/lib/images";
import { detailHref, yearOf } from "@/lib/viewer/format";
import type { Card } from "@/lib/viewer/catalog";
import { BookmarkToggle } from "./bookmarks";
import { CardLink } from "./card-link";
import { PlayIcon } from "./icons";

export type CardVariant = "poster" | "landscape";

/** Plex-style card: image with a light hover, title and meta underneath (spec §5, Q15). */
export function MediaCard({ item, variant = "poster", badge = false, meta, logo = false }: { item: Card; variant?: CardVariant; badge?: boolean; meta?: string; /** Overlay the title logo on landscape cards. */ logo?: boolean }) {
  const landscape = variant === "landscape";
  const src = landscape ? imageUrl(item.backdropPath ?? item.posterPath, "w780") : imageUrl(item.posterPath, "w342");
  const logoSrc = landscape && logo ? imageUrl(item.logoPath, "w300") : null;
  const sub = meta ?? [yearOf(item.date), badge ? (item.kind === "movie" ? "Movie" : "TV Show") : ""].filter(Boolean).join(" · ");
  return (
    <div className="v-card" data-variant={variant}>
      <CardLink href={detailHref(item.kind, item.id)} className="v-card-link" morphId={landscape ? undefined : item.id}>
        <div className="v-card-img">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, sizes picked per use
            <img src={src} alt="" width={landscape ? 780 : 342} height={landscape ? 439 : 513} loading="lazy" decoding="async" />
          ) : (
            <span className="v-card-ph">{item.title}</span>
          )}
          {logoSrc && (
            <span className="v-card-logo" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN */}
              <img src={logoSrc} alt="" loading="lazy" decoding="async" />
            </span>
          )}
          {item.dubs && item.dubs.length > 0 && (
            <span className="v-card-dubs">
              {item.dubs.map((c) => audioLabel(c) && <span key={c}>{audioLabel(c)} dub</span>)}
            </span>
          )}
          <span className="v-card-play" aria-hidden="true"><PlayIcon size={18} /></span>
        </div>
        <span className="v-card-title">{item.title}</span>
        {sub && <span className="v-card-sub">{sub}</span>}
      </CardLink>
      <BookmarkToggle kind={item.kind} id={item.id} title={item.title} />
    </div>
  );
}
