import { CdnFiles } from "../../_components/evo-controls";
import { PageHeader } from "../../_components/page-header";

/** `?engine=<id>` picks the engine whose CDN account is listed (default: the primary one). */
export default async function EvoCdnPage({ searchParams }: { searchParams: Promise<{ engine?: string }> }) {
  const { engine } = await searchParams;
  return (
    <>
      <PageHeader title="CDN files" />
      <CdnFiles engine={engine} />
    </>
  );
}
