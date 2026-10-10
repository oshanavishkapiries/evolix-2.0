import Link from "next/link";
import type { Card } from "@/lib/viewer/catalog";
import { PosterCard } from "./poster-card";
import { ScrollRow } from "./scroll-row";

/** Horizontal scroll-snap row of poster cards (links, so it is keyboard accessible). */
export function ContentRow({ title, items, href, badge }: { title: string; items: Card[]; href?: string; badge?: boolean }) {
  if (!items.length) return null;
  return (
    <section className="v-row" aria-label={title}>
      <div className="v-row-head">
        <h2>{title}</h2>
        {href && <Link href={href}>See all</Link>}
      </div>
      <ScrollRow label={title}>
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <PosterCard item={item} badge={badge} />
          </li>
        ))}
      </ScrollRow>
    </section>
  );
}
