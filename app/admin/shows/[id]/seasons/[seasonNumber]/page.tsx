import { notFound } from "next/navigation";
import { SeasonPage } from "../../../../_components/season-pages";
import { getSeasonDetail } from "@/lib/cms/shows";

export default async function ShowSeasonPage({ params }: { params: Promise<{ id: string; seasonNumber: string }> }) {
  const { id, seasonNumber } = await params;
  if (!/^\d{1,5}$/.test(seasonNumber)) notFound();
  const detail = await getSeasonDetail(id, Number(seasonNumber));
  if (!detail) notFound();
  return <SeasonPage key={detail.season.id} season={detail.season} episodes={detail.episodes} />;
}
