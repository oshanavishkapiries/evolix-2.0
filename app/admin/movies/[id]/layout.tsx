import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EntityShell, type Entity } from "../../_components/entity-shell";
import { HeaderSkeleton } from "../../_components/skeletons";
import { isUuid } from "@/lib/cms/api";
import { getMovie } from "@/lib/cms/movies";

async function Shell({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const movie = isUuid(id) ? await getMovie(id) : null;
  if (!movie) notFound();
  return (
    <EntityShell key={movie.id} kind="movie" initial={movie as unknown as Entity}>
      {children}
    </EntityShell>
  );
}

export default function MovieLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  return (
    <Suspense fallback={<HeaderSkeleton />}>
      <Shell params={params}>{children}</Shell>
    </Suspense>
  );
}
