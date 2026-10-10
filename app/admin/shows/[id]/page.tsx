import { OverviewPage } from "../../_components/entity-pages";
import { isUuid } from "@/lib/cms/api";
import { showCounts } from "@/lib/cms/counts";

export default async function ShowOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const counts = isUuid(id) ? await showCounts(id) : { seasons: 0, episodes: 0, sources: 0, subtitles: 0, videos: 0 };
  return <OverviewPage counts={counts} />;
}
