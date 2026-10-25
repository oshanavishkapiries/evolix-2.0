"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/client/admin";
import { useDebouncedValue } from "@/lib/client/use-debounced";

type Row = { id: string; email: string; readAt: string | null };
const PAGE_SIZE = 25;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** Who has read an announcement and who has not, among its recipients; searchable and paged. */
export function AnnouncementReaders({ id }: { id: string }) {
  const [kind, setKind] = useState<"read" | "unread">("read");
  const [text, setText] = useState("");
  const [q] = useDebouncedValue(text.trim());
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ users: Row[]; total: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    const params = new URLSearchParams({ kind, q, page: String(page), pageSize: String(PAGE_SIZE) });
    adminApi<{ users: Row[]; total: number }>("GET", `/api/admin/announcements/${id}/readers?${params}`, undefined, ctrl.signal).then((res) => {
      if (ctrl.signal.aborted) return;
      if (res.ok) {
        setData({ users: res.users, total: res.total });
        setError("");
      } else setError(res.message ?? "Could not load users");
    });
    return () => ctrl.abort();
  }, [id, kind, q, page]);

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const tab = (k: "read" | "unread", label: string) => (
    <button type="button" className="btn-secondary" aria-pressed={kind === k} onClick={() => { setKind(k); setPage(1); }}>{label}</button>
  );

  return (
    <section className="mt-6" aria-label="Readers">
      <div className="toolbar" role="group" aria-label="Readers filter">{tab("read", "Read")}{tab("unread", "Not read yet")}</div>
      <p className="mt-3">
        <label className="sr-only" htmlFor="readers-q">Search users</label>
        <input id="readers-q" type="search" placeholder="Search by email" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} />
      </p>
      {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
      {data && (data.users.length === 0 ? (
        <p className="mt-3 text-sm">{q ? "No users match." : kind === "read" ? "Nobody has read it yet." : "Everyone has read it."}</p>
      ) : (
        <div className="table-wrap mt-3">
          <table className="data-table">
            <thead><tr><th>User</th>{kind === "read" && <th>First read</th>}</tr></thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  {kind === "read" && <td style={{ whiteSpace: "nowrap" }}>{u.readAt ? fmt(u.readAt) : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {pages > 1 && (
        <nav className="mt-3 flex items-center gap-3 text-sm" aria-label="Pagination">
          <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages} · {data?.total} users</span>
          <button type="button" className="btn-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </nav>
      )}
    </section>
  );
}
