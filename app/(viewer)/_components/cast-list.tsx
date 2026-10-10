import type { CastMember } from "@/db/schema";
import { imageUrl } from "@/lib/images";
import { initials } from "@/lib/viewer/format";
import { ScrollRow } from "./scroll-row";

export function CastList({ cast }: { cast: CastMember[] }) {
  const top = cast.slice(0, 20);
  if (!top.length) return null;
  return (
    <ScrollRow label="Cast" variant="cast" head={<h2>Cast &amp; crew</h2>}>
      {top.map((c, i) => {
        const src = imageUrl(c.profilePath, "w185");
        return (
          <li key={`${c.name}-${i}`} className="v-cast-card">
            <div className="v-cast-img">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
                <img src={src} alt="" width={185} height={278} loading="lazy" decoding="async" />
              ) : (
                <span aria-hidden="true">{initials(c.name)}</span>
              )}
            </div>
            <p className="v-cast-name">{c.name}</p>
            {c.character && <p className="v-cast-char">{c.character}</p>}
          </li>
        );
      })}
    </ScrollRow>
  );
}
