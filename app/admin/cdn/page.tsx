import { like } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { CdnManager } from "../_components/cdn-manager";
import { PageHeader } from "../_components/page-header";

/** `?engine=<id>` picks the engine whose CDN account is managed (default: the primary one). */
export default async function CdnPage({ searchParams }: { searchParams: Promise<{ engine?: string }> }) {
  const { engine } = await searchParams;
  // Files no catalog source points at are orphans (leftovers that only cost storage).
  const rows = await db.select({ url: sources.url }).from(sources).where(like(sources.url, "https://pixeldrain.com/api/file/%"));
  return (
    <>
      <PageHeader title="CDN files" />
      <CdnManager engine={engine} usedUrls={rows.map((r) => r.url)} />
    </>
  );
}
