import { cache, Suspense } from "react";
import { currentUserId } from "@/lib/viewer/user";
import { resumeFor } from "@/lib/viewer/library";
import { getDetailVideos, getShowDetail, type MovieDetail, type ShowDetail } from "@/lib/viewer/detail";
import { parseNumber } from "@/lib/viewer/ids";
import { audioLabel } from "@/lib/audio";
import { isImagePath } from "@/lib/images";
import { PlayLink } from "./play-link";
import { PlayIcon } from "./icons";
import type { PlayAction } from "./detail-header";
import { CastList } from "./cast-list";
import { Gallery } from "./gallery";
import { DetailFacts } from "./detail-facts";
import { Trailers } from "./trailers";
import { Seasons } from "./seasons";
import { RowSkeleton } from "./skeletons";

type Personal = { kind: "movie" | "show"; id: string; playable?: boolean; first?: ShowDetail["first"] };
// Primitive arguments let both header slots and the seasons boundary share the request read.
const personalResume = cache(async (kind: "movie" | "show", id: string, playable: boolean) => {
  if (!playable) return null;
  const userId = await currentUserId();
  return userId ? resumeFor(userId, kind, id) : null;
});
const left = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m} min left`;
async function personalAction(p: Personal): Promise<PlayAction | null> {
  const available = p.kind === "movie" ? Boolean(p.playable) : Boolean(p.first);
  const resume = await personalResume(p.kind, p.id, available);
  if (resume && p.kind === "show") {
    const code = resume.label.split(" - ")[0]?.replace(":", " · ") ?? "";
    return { href: resume.href, label: `${resume.percent > 0 ? "Resume" : "Continue"} ${code}`, detail: resume.label, percent: resume.percent };
  }
  if (p.kind === "movie" && available) return {
    href: `/watch/movie/${p.id}`, label: resume ? "Resume" : "Play",
    detail: resume?.leftMinutes ? left(resume.leftMinutes) : undefined, percent: resume?.percent,
  };
  return p.first ? { href: `/watch/tv/${p.id}/${p.first.seasonNumber}/${p.first.episodeNumber}`, label: `Play S${p.first.seasonNumber} · E${p.first.episodeNumber}` } : null;
}
export async function DetailPersonalPlay(p: Personal) {
  const play = await personalAction(p);
  return play ? <PlayLink href={play.href} className="v-btn v-btn-primary v-btn-lg"><PlayIcon size={18} /> {play.label}</PlayLink>
    : <span className="v-btn v-btn-lg" aria-disabled="true">Not available yet</span>;
}
export async function DetailPersonalProgress(p: Personal) {
  const play = await personalAction(p);
  return play?.detail ? <div className="v-detail-progress">
    {typeof play.percent === "number" && play.percent > 0 && <span className="v-progress" aria-hidden="true"><span style={{ width: `${play.percent}%` }} /></span>}
    <span>{play.detail}</span>
  </div> : null;
}

export async function DetailPersonalDubs(p: Personal & { dubs: string[] }) {
  if (!p.dubs.length) return null;
  const play = await personalAction(p);
  return <div className="v-dubs"><span>Audio:</span>{p.dubs.map((code) =>
    play && p.dubs.length > 1
      ? <PlayLink key={code} href={`${play.href}${play.href.includes("?") ? "&" : "?"}lang=${code}`}>{audioLabel(code)} dub</PlayLink>
      : <span key={code} className="v-dub">{audioLabel(code)} dub</span>
  )}</div>;
}

type Item = MovieDetail | ShowDetail;
type Extras = { kind: "movie" | "tv"; item: Item };
const videosFor = ({ kind, item }: Extras) => getDetailVideos(kind, item.id, item.tmdbId, item.videos);
export async function DetailTrailerLink(p: Extras) {
  return (await videosFor(p)).length ? <a href="#extras" className="v-btn v-btn-lg">Trailers &amp; extras</a> : null;
}
async function DetailTrailers(p: Extras) {
  return <Trailers videos={await videosFor(p)} />;
}
export function DetailSections({ kind, item, facts }: Extras & { facts: [string, string][] }) {
  const paths = [...new Set([item.backdropPath, ...item.galleryBackdrops])].filter(isImagePath);
  return <div className="v-detail-more">
    <Suspense fallback={<RowSkeleton />}><CastList cast={item.cast} /></Suspense>
    <Suspense fallback={<RowSkeleton landscape />}><DetailTrailers kind={kind} item={item} /></Suspense>
    <Suspense fallback={<RowSkeleton landscape />}><Gallery paths={paths} title={item.title} /></Suspense>
    <DetailFacts facts={facts} />
  </div>;
}
export async function DetailSeasons({ id, searchParams }: { id: string; searchParams: Promise<{ season?: string | string[] }> }) {
  const sp = await searchParams;
  const season = parseNumber(Array.isArray(sp.season) ? sp.season[0] : sp.season, 1000);
  const show = await getShowDetail(id, season);
  if (!show) return null; // The hero already validated title visibility before streaming started.
  const resume = await personalResume("show", show.id, Boolean(show.first));
  return <Seasons show={show} resumeHref={resume?.href} />;
}
