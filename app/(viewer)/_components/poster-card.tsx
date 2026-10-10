import Link from "next/link";
import { imageUrl } from "@/lib/images";
import { detailHref, ratingText, yearOf } from "@/lib/viewer/format";
import type { Card } from "@/lib/viewer/catalog";

export function PosterCard({ item, badge = false }: { item: Card; badge?: boolean }) {
  const src = imageUrl(item.posterPath, "w342");
  const year = yearOf(item.date);
  const rating = ratingText(item.rating);
  return (
    <Link href={detailHref(item.kind, item.id)} className="v-card" prefetch={false}>
      <div className="v-card-img">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, sizes picked per use
          <img src={src} alt={`Poster for ${item.title}`} width={342} height={513} loading="lazy" decoding="async" />
        ) : (
          <span className="v-card-ph">{item.title}</span>
        )}
        {badge && <span className="v-card-badge">{item.kind === "movie" ? "Movie" : "Show"}</span>}
      </div>
      <p className="v-card-title">{item.title}</p>
      <p className="v-card-sub">
        {year && <span>{year}</span>}
        {rating && <span aria-label={`Rated ${rating}`}>★ {rating}</span>}
      </p>
    </Link>
  );
}
