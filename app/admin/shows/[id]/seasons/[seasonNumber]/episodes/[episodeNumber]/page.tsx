import { notFound } from "next/navigation";
import { EpisodePage } from "../../../../../../_components/season-pages";
import { getEpisodeDetail } from "@/lib/cms/shows";

export default async function ShowEpisodePage({
  params,
}: {
  params: Promise<{ id: string; seasonNumber: string; episodeNumber: string }>;
}) {
  const { id, seasonNumber, episodeNumber } = await params;
  if (!/^\d{1,6}$/.test(seasonNumber) || !/^\d{1,6}$/.test(episodeNumber)) notFound();
  const detail = await getEpisodeDetail(id, Number(seasonNumber), Number(episodeNumber));
  if (!detail) notFound();
  return (
    <EpisodePage
      key={detail.episode.id}
      seasonNumber={detail.season.seasonNumber}
      episode={detail.episode}
      prev={detail.prev}
      next={detail.next}
    />
  );
}
