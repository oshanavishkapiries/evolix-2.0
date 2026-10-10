import Link from "next/link";
import { imageUrl } from "@/lib/images";
import { detailHref, ratingText, yearOf } from "@/lib/viewer/format";
import type { Card } from "@/lib/viewer/catalog";
import { BookmarkToggle } from "./bookmarks";
import { PlayIcon } from "./icons";

export function PosterCard({ item, badge = false }: { item: Card; badge?: boolean }) {
  const src = imageUrl(item.posterPath, "w342");
  const year = yearOf(item.date);
  const rating = ratingText(item.rating);
  return (
    <div className="v-card">
      <Link href={detailHref(item.kind, item.id)} className="v-card-link" prefetch={false}>
      <div className="v-card-img">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, sizes picked per use
          <img src={src} alt={`Poster for ${item.title}`} width={342} height={513} loading="lazy" decoding="async" />
        ) : (
          <span className="v-card-ph">{item.title}</span>
        )}
        {badge && <span className="v-card-badge">{item.kind === "movie" ? "Movie" : "Show"}</span>}
        <span className="v-card-hover" aria-hidden="true">
          <span className="v-card-play"><PlayIcon size={24} /></span>
        </span>
        <span className="v-card-info">
          <span className="v-card-title">{item.title}</span>
          <span className="v-card-sub">
            {year && <span>{year}</span>}
            {rating && <span aria-label={`Rated ${rating}`}>★ {rating}</span>}
          </span>
        </span>
      </div>
      </Link>
      <BookmarkToggle kind={item.kind} id={item.id} title={item.title} />
    </div>
  );
}
