import Link from "next/link";
import { tmdbImage } from "@/lib/client/admin";

export type TitleRow = {
  id: string;
  title?: string;
  name?: string;
  releaseDate?: string | null;
  firstAirDate?: string | null;
  posterPath?: string | null;
  isPublished: boolean;
};
export type TitleKind = "movies" | "shows";

const year = (d?: string | null) => (d ? d.slice(0, 4) : "n/a");

export function StatusBadge({ published }: { published: boolean }) {
  return <span className={`badge ${published ? "badge-on" : "badge-off"}`}>{published ? "Published" : "Draft"}</span>;
}

/** List of titles with poster thumbnail, link to the item and status badge. */
export function TitleRows({ kind, rows }: { kind: TitleKind; rows: TitleRow[] }) {
  return (
    <ul className="rows">
      {rows.map((r) => {
        const label = r.title ?? r.name ?? "Untitled";
        const thumb = tmdbImage(r.posterPath, "w92");
        return (
          <li key={r.id}>
            <span className="flex min-w-0 items-center gap-3">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb} alt="" width={36} height={54} loading="lazy" className="h-[54px] w-9 shrink-0 rounded object-cover" />
              ) : (
                <span className="h-[54px] w-9 shrink-0 rounded bg-gray-200 dark:bg-gray-800" aria-hidden="true" />
              )}
              <span className="min-w-0 break-words">
                <Link href={`/admin/${kind}/${r.id}`}>{label}</Link> ({year(r.releaseDate ?? r.firstAirDate)})
              </span>
            </span>
            <StatusBadge published={r.isPublished} />
          </li>
        );
      })}
    </ul>
  );
}
