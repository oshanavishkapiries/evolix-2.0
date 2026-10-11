import Link from "next/link";
import { Suspense } from "react";
import { listReports, reportCounts } from "@/lib/cms/reports";
import { REPORT_STATUSES, reasonLabel, type ReportStatus } from "@/lib/reports";
import { PageHeader } from "../_components/page-header";
import { ReportActions } from "../_components/report-actions";

const PAGE_SIZE = 20;
type Props = { searchParams: Promise<{ status?: string; page?: string }> };

const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

export default function ReportsPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader title="Reports" />
      <Suspense fallback={<div className="skeleton mt-4 h-32" aria-busy="true" />}>
        <ReportsList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ReportsList({ searchParams }: Props) {
  const sp = await searchParams;
  const status: ReportStatus = REPORT_STATUSES.find((s) => s === sp.status) ?? "open";
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ items, total }, counts] = await Promise.all([listReports({ status, page, pageSize: PAGE_SIZE }), reportCounts()]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (s: ReportStatus, p = 1) => `/admin/reports?status=${s}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <>
      <nav aria-label="Report status" className="tabs">
        <ul>
          {REPORT_STATUSES.map((s) => (
            <li key={s}>
              <Link href={href(s)} className="tab" aria-current={s === status ? "page" : undefined}>
                {s[0].toUpperCase() + s.slice(1)} ({counts[s]})
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {!items.length ? (
        <p className="mt-4 text-sm">No {status} reports.</p>
      ) : (
        <div className="table-wrap mt-4">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Reason</th>
                <th>Message</th>
                <th>Reported by</th>
                <th>When</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.titleId ? (
                      <Link href={`/admin/${r.kind === "movie" ? "movies" : "shows"}/${r.titleId}`}>{r.title}</Link>
                    ) : (
                      r.title
                    )}
                    <div className="text-xs">{r.kind === "episode" ? r.context : r.kind === "movie" ? "Movie" : "TV show"}</div>
                  </td>
                  <td>{reasonLabel(r.reason)}</td>
                  <td style={{ maxWidth: "22rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.message || "—"}</td>
                  <td>{r.reporter}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmt(r.createdAt)}</td>
                  <td><ReportActions id={r.id} status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Pagination">
          {page > 1 ? <Link href={href(status, page - 1)}>Previous</Link> : <span>Previous</span>}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link href={href(status, page + 1)}>Next</Link> : <span>Next</span>}
        </nav>
      )}
    </>
  );
}
