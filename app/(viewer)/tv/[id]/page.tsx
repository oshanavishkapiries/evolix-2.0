import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseMediaId } from "@/lib/viewer/ids";
import { getShowHero } from "@/lib/viewer/detail";
import { dateText, languageName, yearOf } from "@/lib/viewer/format";
import { DetailHeader } from "../../_components/detail-header";
import { detailMetadata } from "../../_components/media-sections";
import { DetailPersonalPlay, DetailPersonalProgress, DetailPersonalDubs, DetailSections, DetailTrailerLink, DetailSeasons } from "../../_components/detail-streams";
import { RowSkeleton } from "../../_components/skeletons";
import { PageMotion } from "../../_components/motion";

// Blocking on purpose: the id is resolved before the response starts, so a missing or
// unpublished title is a real HTTP 404 instead of a streamed 200.
export const instant = false;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ season?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const show = parseMediaId(id) ? await getShowHero(id) : null;
  if (!show) return { title: "Not found" };
  const year = yearOf(show.firstAirDate);
  return detailMetadata(year ? `${show.title} (${year})` : show.title, show.overview, show.backdropPath);
}

export default async function ShowPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!parseMediaId(id)) notFound();
  const show = await getShowHero(id);
  if (!show) notFound();

  const { first } = show;
  const personal = { kind: "show" as const, id: show.id, first };
  const play = first ? { href: `/watch/tv/${show.id}/${first.seasonNumber}/${first.episodeNumber}`, label: `Play S${first.seasonNumber} · E${first.episodeNumber}` } : null;
  const seasonCount = show.seasons.filter((s) => s.seasonNumber > 0).length;

  return (
    <PageMotion>
    <div className="v-detail">
      <DetailHeader
        kind="show"
        id={show.id}
        title={show.title}
        tagline={show.tagline}
        overview={show.overview}
        date={show.firstAirDate}
        rating={show.rating}
        genres={show.genres}
        facts={seasonCount ? [`${seasonCount} ${seasonCount === 1 ? "season" : "seasons"}`] : []}
        posterPath={show.posterPath}
        backdropPath={show.backdropPath}
        play={play}
        playSlot={<Suspense fallback={<span className="v-btn v-btn-primary v-btn-lg" aria-busy="true" aria-disabled="true">Play</span>}><DetailPersonalPlay {...personal} /></Suspense>}
        progressSlot={<Suspense fallback={null}><DetailPersonalProgress {...personal} /></Suspense>}
        extrasSlot={<Suspense fallback={null}><DetailTrailerLink kind="tv" item={show} /></Suspense>}
        voteCount={show.voteCount}
        dubsSlot={<Suspense fallback={null}><DetailPersonalDubs {...personal} dubs={show.dubs} /></Suspense>}
      />
      <Suspense fallback={<RowSkeleton />}><DetailSeasons id={id} searchParams={searchParams} /></Suspense>
      <Suspense fallback={<RowSkeleton />}><DetailSections
        kind="tv"
        item={show}
        facts={[
          ["Original title", show.originalTitle && show.originalTitle !== show.title ? show.originalTitle : ""],
          ["First aired", dateText(show.firstAirDate)],
          ["Last aired", dateText(show.lastAirDate)],
          ["Seasons", seasonCount ? String(seasonCount) : ""],
          ["Status", show.status],
          ["Original language", languageName(show.originalLanguage)],
          ["Genres", show.genres.join(", ")],
        ]}
      /></Suspense>
    </div>
    </PageMotion>
  );
}
