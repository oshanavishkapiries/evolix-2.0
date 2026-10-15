import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseMediaId, parseNumber } from "@/lib/viewer/ids";
import { getShowDetail } from "@/lib/viewer/detail";
import { dateText, languageName, yearOf } from "@/lib/viewer/format";
import { resumeFor } from "@/lib/viewer/library";
import { currentUserId } from "@/lib/viewer/user";
import { DetailHeader, type PlayAction } from "../../_components/detail-header";
import { detailMetadata, MediaSections } from "../../_components/media-sections";
import { Seasons } from "../../_components/seasons";
import { PageMotion } from "../../_components/motion";

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
  const show = parseMediaId(id) ? await getShowDetail(id, seasonOf(sp.season)) : null;
  if (!show) return { title: "Not found" };
  const year = yearOf(show.firstAirDate);
  return detailMetadata(year ? `${show.title} (${year})` : show.title, show.overview, show.backdropPath);
}

export default async function ShowPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!parseMediaId(id)) notFound();
  const [show, userId] = await Promise.all([getShowDetail(id, seasonOf(sp.season)), currentUserId()]);
  if (!show) notFound();

  const { first } = show;
  const resume = userId && first ? await resumeFor(userId, "show", show.id) : null;
  const code = resume?.label.split(" - ")[0]?.replace(":", " · ") ?? "";
  const play: PlayAction | null = resume
    ? { href: resume.href, label: resume.percent > 0 ? `Resume ${code}` : `Continue ${code}`, detail: resume.label, percent: resume.percent }
    : first
      ? { href: `/watch/tv/${show.id}/${first.seasonNumber}/${first.episodeNumber}`, label: "Play S" + first.seasonNumber + " · E" + first.episodeNumber }
      : null;
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
        voteCount={show.voteCount}
        hasExtras={show.videos.length > 0}
        dubs={show.dubs}
      />
      <Seasons show={show} resumeHref={resume?.href} />
      <MediaSections
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
      />
    </div>
    </PageMotion>
  );
}
