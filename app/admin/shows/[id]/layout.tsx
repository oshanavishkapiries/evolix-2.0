import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EntityShell, type Entity } from "../../_components/entity-shell";
import { HeaderSkeleton } from "../../_components/skeletons";
import { isUuid } from "@/lib/cms/api";
import { getShow } from "@/lib/cms/shows";

async function Shell({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const show = isUuid(id) ? await getShow(id) : null;
  if (!show) notFound();
  return (
    <EntityShell key={show.id} kind="show" initial={show as unknown as Entity}>
      {children}
    </EntityShell>
  );
}

export default function ShowLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  return (
    <Suspense fallback={<HeaderSkeleton />}>
      <Shell params={params}>{children}</Shell>
    </Suspense>
  );
}
