import { notFound } from "next/navigation";
import { Suspense } from "react";
import { engineTaskDetail } from "@/lib/cms/evo";
import { Breadcrumbs } from "../../_components/breadcrumbs";
import { TaskFlow } from "../../_components/pipeline-graph";
import { PageHeader } from "../../_components/page-header";

type Props = { params: Promise<{ taskId: string }> };

export default function EvoTaskPage({ params }: Props) {
  return (
    <Suspense fallback={<div className="skeleton mt-4 h-64" aria-busy="true" />}>
      <Task params={params} />
    </Suspense>
  );
}

async function Task({ params }: Props) {
  const { taskId } = await params;
  const detail = /^[0-9a-f-]{36}$/i.test(taskId) ? await engineTaskDetail(taskId) : null;
  if (!detail) notFound();
  const { task, events } = detail;
  const se = task.season !== null && task.episode !== null ? ` S${task.season}E${task.episode}` : "";

  return (
    <>
      <Breadcrumbs items={[{ label: "Evo pipeline", href: "/admin/evo" }, { label: `${task.title ?? `TMDB ${task.tmdb_id}`}${se}` }]} />
      <PageHeader title={`${task.title ?? `TMDB ${task.tmdb_id}`}${se}`} />
      <p className="text-sm">
        {task.requested_quality === "sub:si" ? "Sinhala subtitles (on demand)" : `asked ${task.requested_quality}`}
        {task.resolved_quality && task.resolved_quality !== task.requested_quality ? `, got ${task.resolved_quality}` : ""} · task <code>{task.task_id}</code>
      </p>
      <div className="mt-4">
        <TaskFlow subtitleJob={task.requested_quality === "sub:si"} taskId={task.task_id} initial={{ task: { status: task.status, message: task.message, cache_failed: task.cache_failed }, events }} />
      </div>
    </>
  );
}
