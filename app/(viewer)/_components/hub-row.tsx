import Link from "next/link";
import type { Card } from "@/lib/viewer/catalog";
import { MediaCard, type CardVariant } from "./media-card";
import { ScrollRow } from "./scroll-row";

/** A titled horizontal row ("hub") of cards; the title links to the full list when `href` is set. */
export function HubRow({ title, subtitle, items, href, variant = "poster", badge }: { title: string; subtitle?: string; items: Card[]; href?: string; variant?: CardVariant; badge?: boolean }) {
  if (!items.length) return null;
  return (
    <ScrollRow
      label={title}
      variant={variant}
      head={
        <>
          <h2>{href ? <Link href={href}>{title}</Link> : title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </>
      }
    >
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`}>
          <MediaCard item={item} variant={variant} badge={badge} />
        </li>
      ))}
    </ScrollRow>
  );
}
