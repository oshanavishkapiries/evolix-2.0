import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isUuid, parseNumber } from "@/lib/viewer/ids";
import { getShowDetail } from "@/lib/viewer/detail";
import { yearOf } from "@/lib/viewer/format";
import { detailMetadata, MediaSections } from "../../_components/media-sections";
import { Seasons } from "../../_components/seasons";
import { NavMarker } from "../../_components/nav-marker";
import { TitleHero } from "../../_components/title-hero";

// Blocking on purpose: the id is resolved before the response starts, so a missing or
// unpublished title is a real HTTP 404 instead of a streamed 200.
export const instant = false;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ season?: string | string[] }>;
};

const seasonOf = (raw: string | string[] | undefined) => parseNumber(Array.isArray(raw) ? raw[0] : raw, 1000);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const show = isUuid(id) ? await getShowDetail(id, seasonOf(sp.season)) : null;
  if (!show) return { title: "Not found" };
  const year = yearOf(show.firstAirDate);
  return detailMetadata(year ? `${show.title} (${year})` : show.title, show.overview, show.backdropPath);
}

export default async function ShowPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  const show = await getShowDetail(id, seasonOf(sp.season));
  if (!show) notFound();

  const { first } = show;
  const seasonCount = show.seasons.filter((s) => s.seasonNumber > 0).length;
  return (
    <>
      <NavMarker active="tv" />
      <TitleHero
        detail
        title={show.title}
        tagline={show.tagline}
        overview={show.overview}
        date={show.firstAirDate}
        rating={show.rating}
        genres={show.genres}
        backdropPath={show.backdropPath}
        logoPath={show.logoPath}
        posterPath={show.posterPath}
        bookmark={{ kind: "show", id: show.id }}
        extra={seasonCount ? `${seasonCount} ${seasonCount === 1 ? "season" : "seasons"}` : undefined}
        playHref={first ? `/watch/tv/${show.id}/${first.seasonNumber}/${first.episodeNumber}` : null}
      />
      <Seasons show={show} />
      <MediaSections item={show} />
    </>
  );
}
