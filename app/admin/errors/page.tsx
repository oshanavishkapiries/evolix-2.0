import Link from "next/link";
import { Suspense } from "react";
import { ISSUE_SORTS, ISSUE_STATUSES, listIssues, type IssueSort, type IssueStatus } from "@/lib/errors/queries";
import { AutoRefresh } from "../_components/auto-refresh";
import { IssueTable, TestErrorButtons } from "../_components/errors-ui";
import { PageHeader } from "../_components/page-header";

const PAGE_SIZE = 25;
const SOURCES = ["server", "client", "engine"];
type SP = { status?: string; source?: string; q?: string; sort?: string; page?: string };

export default function ErrorsPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <>
      <AutoRefresh seconds={20} />
      <PageHeader title="Errors" actions={<TestErrorButtons />} />
      <Suspense fallback={<div className="skeleton mt-4 h-64" aria-busy="true" />}>
        <Issues searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Issues({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const status: IssueStatus | "all" = sp.status === "all" ? "all" : (ISSUE_STATUSES.find((s) => s === sp.status) ?? "unresolved");
  const source = SOURCES.includes(sp.source ?? "") ? sp.source : undefined;
  const sort = (sp.sort && sp.sort in ISSUE_SORTS ? sp.sort : "last") as IssueSort;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, counts } = await listIssues({ status, source, q, sort, page, pageSize: PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (over: Partial<SP>) => {
    const qs = new URLSearchParams();
    const next = { status: status === "unresolved" ? undefined : status, source, q: q || undefined, sort: sort === "last" ? undefined : sort, ...over };
    for (const [k, v] of Object.entries(next)) if (v) qs.set(k, String(v));
    return `/admin/errors${qs.size ? `?${qs}` : ""}`;
  };
  const label = (s: string) => s[0].toUpperCase() + s.slice(1);

  return (
    <>
      <nav aria-label="Issue status" className="tabs">
        <ul>
          {ISSUE_STATUSES.map((s) => (
            <li key={s}>
              <Link href={href({ status: s === "unresolved" ? undefined : s, page: undefined })} className="tab" aria-current={s === status ? "page" : undefined}>
                {label(s)} ({counts[s]})
              </Link>
            </li>
          ))}
          <li>
            <Link href={href({ status: "all", page: undefined })} className="tab" aria-current={status === "all" ? "page" : undefined}>All</Link>
          </li>
        </ul>
      </nav>

      <form className="err-filters" action="/admin/errors">
        {status !== "unresolved" && <input type="hidden" name="status" value={status} />}
        <label className="err-search">
          <span className="sr-only">Search errors</span>
          <input type="search" name="q" defaultValue={q} placeholder="Search message, type or location" />
        </label>
        <label>
          <span className="sr-only">Source</span>
          <select name="source" defaultValue={source ?? ""}>
            <option value="">All sources</option>
            {SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Sort</span>
          <select name="sort" defaultValue={sort}>
            {Object.entries(ISSUE_SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button type="submit" className="btn-secondary">Apply</button>
      </form>

      {rows.length === 0 ? (
        <div className="card mt-4 text-center">
          <p className="text-base font-semibold">{q || source ? "No issues match these filters." : status === "unresolved" ? "No open errors. Nice." : `No ${status} issues.`}</p>
          <p className="mt-1 text-sm">Server errors, browser crashes and engine failures show up here as they happen. Use the test buttons to check the pipeline.</p>
        </div>
      ) : (
        <IssueTable rows={rows.map((r) => ({ ...r, firstSeen: r.firstSeen.toISOString(), lastSeen: r.lastSeen.toISOString() }))} />
      )}

      {pages > 1 && (
        <p className="toolbar mt-3 justify-between text-sm">
          <span>{total} issues - page {page} of {pages}</span>
          <span className="toolbar">
            {page > 1 ? <Link href={href({ page: String(page - 1) })}>Previous</Link> : <span>Previous</span>}
            {page < pages ? <Link href={href({ page: String(page + 1) })}>Next</Link> : <span>Next</span>}
          </span>
        </p>
      )}
    </>
  );
}
