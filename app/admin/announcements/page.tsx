import { AutoRefresh } from "../_components/auto-refresh";
import Link from "next/link";
import { AnnouncementDelete } from "../_components/announcement-delete";
import { Suspense } from "react";
import { ANNOUNCEMENT_STATES, audienceLabel, type AnnouncementState } from "@/lib/announcements";
import { announcementCounts, listAnnouncements } from "@/lib/cms/announcements";
import { PageHeader } from "../_components/page-header";
import { TZ } from "@/lib/tz";

const PAGE_SIZE = 20;
type Props = { searchParams: Promise<{ state?: string; page?: string }> };

const fmt = (d: Date | null) => (d ? d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TZ }) : "—");
const label = (s: string) => s[0].toUpperCase() + s.slice(1);

export default function AnnouncementsPage({ searchParams }: Props) {
  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title="Announcements" actions={<Link href="/admin/announcements/new" className="btn">New announcement</Link>} />
      <Suspense fallback={<div className="skeleton mt-4 h-32" aria-busy="true" />}>
        <List searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function List({ searchParams }: Props) {
  const sp = await searchParams;
  const state: AnnouncementState | undefined = ANNOUNCEMENT_STATES.find((s) => s === sp.state);
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ items, total }, counts] = await Promise.all([listAnnouncements({ state, page, pageSize: PAGE_SIZE }), announcementCounts()]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (s?: AnnouncementState, p = 1) => {
    const qs = new URLSearchParams();
    if (s) qs.set("state", s);
    if (p > 1) qs.set("page", String(p));
    return `/admin/announcements${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <>
      <nav aria-label="Announcement state" className="tabs">
        <ul>
          <li><Link href={href()} className="tab" aria-current={!state ? "page" : undefined}>All</Link></li>
          {ANNOUNCEMENT_STATES.map((s) => (
            <li key={s}>
              <Link href={href(s)} className="tab" aria-current={s === state ? "page" : undefined}>{label(s)} ({counts[s]})</Link>
            </li>
          ))}
        </ul>
      </nav>
      {!items.length ? (
        <p className="mt-4 text-sm">No {state ?? ""} announcements{state ? "" : " yet"}.</p>
      ) : (
        <div className="table-wrap mt-4">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>State</th>
                <th>Audience</th>
                <th>Published</th>
                <th>Expires</th>
                <th>Read</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const rate = a.recipients ? Math.round((a.reads / a.recipients) * 100) : 0;
                return (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/admin/announcements/${a.id}`}>{a.title}</Link>
                      {a.priority === "banner" && <div className="text-xs">Banner</div>}
                    </td>
                    <td>{label(a.state)}</td>
                    <td>{audienceLabel(a.audience)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmt(a.publishAt)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmt(a.expiresAt)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {a.state === "draft" ? "—" : `${a.reads} / ${a.recipients} (${rate}%)`}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <AnnouncementDelete id={a.id} title={a.title} draft={a.state === "draft"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Pagination">
          {page > 1 ? <Link href={href(state, page - 1)}>Previous</Link> : <span>Previous</span>}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link href={href(state, page + 1)}>Next</Link> : <span>Next</span>}
        </nav>
      )}
    </>
  );
}
