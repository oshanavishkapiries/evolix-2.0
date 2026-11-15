import Link from "next/link";
import { registeredEngines } from "@/lib/evo/registry";
import { LocalCdnPanel } from "../_components/local-cdn-panel";
import { db } from "@/db";
import { sources, subtitles } from "@/db/schema";
import { CdnManager } from "../_components/cdn-manager";
import { PageHeader } from "../_components/page-header";

/** `?engine=<id>` picks the engine whose CDN account is managed (default: the primary one). */
export default async function CdnPage({ searchParams }: { searchParams: Promise<{ engine?: string }> }) {
  const { engine } = await searchParams;
  const engines = await registeredEngines();
  // Files no catalog source points at are orphans (leftovers that only cost storage).
  const rows = (await Promise.all([
    db.select({ url: sources.url }).from(sources),
    db.select({ url: subtitles.url }).from(subtitles),
  ])).flat();
  return (
    <>
      <PageHeader title="CDN files" />
      <nav className="toolbar mb-4" aria-label="CDN engine">{engines.map((item) => <Link key={item.id} href={`/admin/cdn?engine=${encodeURIComponent(item.id)}`} aria-current={engine === item.id ? "page" : undefined}>{item.name}</Link>)}</nav>
      {engines.map((item) => <LocalCdnPanel key={item.id} engine={item.id} name={item.name} />)}
      <CdnManager key={engine ?? "default"} engine={engine} usedUrls={rows.map((r) => r.url)} />
    </>
  );
}
