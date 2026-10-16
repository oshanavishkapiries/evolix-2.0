import Link from "next/link";
import { Suspense } from "react";
import { engineOverview, recentCachedSources } from "@/lib/cms/evo";
import { PageHeader } from "../_components/page-header";

const fmt = (d: Date | string) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
const code = (s: number | null, e: number | null) => (s !== null && e !== null ? `S${s}E${e}` : "Movie");

export default function EvoPage() {
  return (
    <>
      <PageHeader title="Evo pipeline" />
      <Suspense fallback={<div className="skeleton mt-4 h-32" aria-busy="true" />}>
        <EvoOverview />
      </Suspense>
    </>
  );
}

async function EvoOverview() {
  const [engine, cached] = await Promise.all([engineOverview(), recentCachedSources()]);
  const failed = engine.tasks.filter((t) => t.status === "FAILED" || t.cache_failed);

  return (
    <>
      <p className="mt-2 text-sm">
        Engine: <strong>{engine.online ? "online" : "offline"}</strong>
        {engine.health && (
          <>
            {" · "}ffmpeg {engine.health.ffmpeg_available ? "ok" : "missing"} · ffprobe {engine.health.ffprobe_available ? "ok" : "missing"} · {String(engine.health.free_disk_gb)} GB free · webhook{" "}
            {engine.health.webhook_configured ? "on" : "off"}
          </>
        )}
        {engine.error && <span> — {engine.error}</span>}
      </p>
      {failed.length > 0 && (
        <p className="mt-2 text-sm">
          {failed.length} recent task(s) failed or were not cached. Viewing the title again (or requesting the quality) retries them.
        </p>
      )}

      <h2 className="mt-6">Engine tasks</h2>
      {!engine.tasks.length ? (
        <p className="mt-2 text-sm">No tasks yet.</p>
      ) : (
        <div className="table-wrap mt-2">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Quality</th>
                <th>Status</th>
                <th>Message</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {engine.tasks.map((t) => (
                <tr key={t.task_id}>
                  <td>
                    {t.title ?? `TMDB ${t.tmdb_id}`}
                    <div className="text-xs">{code(t.season, t.episode)}</div>
                  </td>
                  <td>{t.resolved_quality ?? t.requested_quality}</td>
                  <td>{t.cache_failed ? `${t.status} (cache failed)` : t.status}</td>
                  <td style={{ maxWidth: "24rem", overflowWrap: "anywhere" }}>{t.message}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmt(t.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-6">Cached sources</h2>
      {!cached.length ? (
        <p className="mt-2 text-sm">Nothing cached yet.</p>
      ) : (
        <div className="table-wrap mt-2">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Quality</th>
                <th>State</th>
                <th>Cached</th>
              </tr>
            </thead>
            <tbody>
              {cached.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/admin/${s.kind === "movie" ? "movies" : "shows"}/${s.titleId}`}>{s.title}</Link>
                    <div className="text-xs">{s.context}</div>
                  </td>
                  <td>{s.quality ?? "—"}</td>
                  <td>{s.isActive ? "active" : "disabled (file gone)"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmt(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
