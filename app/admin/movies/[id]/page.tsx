import { OverviewPage } from "../../_components/entity-pages";
import { isUuid } from "@/lib/cms/api";
import { movieCounts } from "@/lib/cms/counts";

export default async function MovieOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const counts = isUuid(id) ? await movieCounts(id) : { sources: 0, subtitles: 0, videos: 0 };
  return <OverviewPage counts={counts} />;
}
