import { SeasonsPage } from "../../../_components/season-pages";
import { listSeasonsWithCounts } from "@/lib/cms/shows";

export default async function ShowSeasonsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SeasonsPage initial={await listSeasonsWithCounts(id)} />;
}
