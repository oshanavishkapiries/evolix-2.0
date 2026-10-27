"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { useConfirm } from "./confirm-dialog";
import { useToast } from "./toast";

type CdnFile = { id: string; name: string; size: number | null; views: number | null; date_upload: string | null; url: string };
type Album = { id: string; title: string; file_count?: number; date_created?: string };
type Account = {
  username?: string;
  subscription?: { name?: string; storage_space?: number; monthly_transfer_cap?: number };
  storage_space_used?: number;
  monthly_transfer_used?: number;
};
type Sort = "newest" | "oldest" | "largest" | "name" | "views";

const btn = "btn-secondary rounded-md border px-3 py-1.5 text-sm";
const danger = "btn-danger rounded-md border px-3 py-1.5 text-sm";
const scoped = (engine?: string) => (engine ? `?engine=${encodeURIComponent(engine)}` : "");
const size = (n: number) => (n >= 1024 ** 4 ? `${(n / 1024 ** 4).toFixed(2)} TB` : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`);
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) : "—");

/** Pixeldrain CDN manager: account usage, searchable/sortable files with batch delete and album creation, and albums. */
export function CdnManager({ engine, usedUrls }: { engine?: string; usedUrls: string[] }) {
  const toast = useToast();
  const confirm = useConfirm();
  const q = scoped(engine);
  const used = useMemo(() => new Set(usedUrls), [usedUrls]);

  const [tab, setTab] = useState<"files" | "albums">("files");
  const [files, setFiles] = useState<CdnFile[] | null>(null);
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState("");
  const [regex, setRegex] = useState(false);
  const [sort, setSort] = useState<Sort>("newest");
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [f, a, u] = await Promise.all([
      adminApi<{ data: CdnFile[] }>("GET", `/api/admin/evo/cdn/files${q}`),
      adminApi<{ data: Album[] }>("GET", `/api/admin/evo/cdn/albums${q}`),
      adminApi<{ data: Account }>("GET", `/api/admin/evo/cdn/user${q}`),
    ]);
    if (f.ok) {
      setFiles(f.data);
      setError("");
      // Forget selections of files that no longer exist.
      setPicked((p) => new Set([...p].filter((id) => f.data.some((x) => x.id === id))));
    } else setError(errorText(f));
    if (a.ok) setAlbums(a.data);
    if (u.ok) setAccount(u.data);
  }, [q]);

  useEffect(() => {
    const first = setTimeout(load, 0); // deferred: load sets state
    const poll = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
    };
  }, [load]);

  const visible = useMemo(() => {
    if (!files) return [];
    let re: RegExp | null = null;
    const term = search.trim();
    if (term && regex) {
      try {
        re = new RegExp(term, "i");
      } catch {
        return [];
      }
    }
    const list = files.filter((f) => {
      if (orphansOnly && used.has(f.url)) return false;
      if (!term) return true;
      return re ? re.test(f.name) : f.name.toLowerCase().includes(term.toLowerCase());
    });
    const by: Record<Sort, (a: CdnFile, b: CdnFile) => number> = {
      newest: (a, b) => (b.date_upload ?? "").localeCompare(a.date_upload ?? ""),
      oldest: (a, b) => (a.date_upload ?? "").localeCompare(b.date_upload ?? ""),
      largest: (a, b) => (b.size ?? 0) - (a.size ?? 0),
      name: (a, b) => a.name.localeCompare(b.name),
      views: (a, b) => (b.views ?? 0) - (a.views ?? 0),
    };
    return [...list].sort(by[sort]);
  }, [files, search, regex, sort, orphansOnly, used]);

  const run = async (fn: () => ReturnType<typeof adminApi>, ok: string) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    toast.success(ok);
    await load();
  };

  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set(p).add(id)));
  const allPicked = visible.length > 0 && visible.every((f) => picked.has(f.id));
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(visible.map((f) => f.id)));
  const chosen = (files ?? []).filter((f) => picked.has(f.id));

  const deleteChosen = async () => {
    const inUse = chosen.filter((f) => used.has(f.url)).length;
    const ok = await confirm({
      title: `Delete ${chosen.length} file(s) from the CDN?`,
      body: inUse ? `${inUse} of them are used by catalog sources; those sources are removed too and the titles are cached again on next play.` : "They are not used by any catalog source.",
      confirmLabel: "Delete files",
    });
    if (!ok) return;
    setBusy(true);
    const res = await adminApi<{ data: { deleted: string[]; failed: { url: string; error: string }[] } }>("POST", `/api/admin/evo/cdn/delete-many${q}`, { urls: chosen.map((f) => f.url) });
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    const failed = res.data.failed.length;
    if (failed) toast.error(`${res.data.deleted.length} deleted, ${failed} failed: ${res.data.failed[0].error}`);
    else toast.success(`${res.data.deleted.length} file(s) deleted`);
    await load();
  };

  const [albumTitle, setAlbumTitle] = useState("");
  const createAlbum = async () => {
    const title = albumTitle.trim();
    if (!title || !chosen.length) return;
    await run(() => adminApi("POST", `/api/admin/evo/cdn/albums${q}`, { title, ids: chosen.map((f) => f.id) }), "Album created");
    setAlbumTitle("");
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  const total = (files ?? []).reduce((n, f) => n + (f.size ?? 0), 0);
  const orphans = (files ?? []).filter((f) => !used.has(f.url));
  const quota = account?.subscription?.storage_space;
  const usedBytes = account?.storage_space_used ?? total;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="stat">
          <h2 className="text-base">Storage</h2>
          <strong>{size(usedBytes)}</strong>
          <small>{quota ? `of ${size(quota)} (${Math.round((usedBytes / quota) * 100)}%)` : "quota unknown"}</small>
        </div>
        <div className="stat">
          <h2 className="text-base">Files</h2>
          <strong>{files?.length ?? "…"}</strong>
          <small>{albums ? `${albums.length} album(s)` : ""}</small>
        </div>
        <div className="stat">
          <h2 className="text-base">Orphans</h2>
          <strong>{files ? orphans.length : "…"}</strong>
          <small>{files ? `${size(orphans.reduce((n, f) => n + (f.size ?? 0), 0))} not used by any source` : ""}</small>
        </div>
      </div>
      {account?.subscription?.name && (
        <p className="mt-2 text-sm">
          Plan <strong>{account.subscription.name}</strong>
          {account.monthly_transfer_used != null && account.subscription.monthly_transfer_cap ? ` · transfer this month ${size(account.monthly_transfer_used)} of ${size(account.subscription.monthly_transfer_cap)}` : ""}
        </p>
      )}

      <div className="toolbar mt-4" role="tablist" aria-label="CDN sections">
        <button type="button" role="tab" aria-selected={tab === "files"} className={tab === "files" ? "" : btn} onClick={() => setTab("files")}>Files</button>
        <button type="button" role="tab" aria-selected={tab === "albums"} className={tab === "albums" ? "" : btn} onClick={() => setTab("albums")}>Albums</button>
        <button type="button" className={btn} onClick={load}>Refresh</button>
      </div>

      {error && <p className="mt-2 text-sm">{error}</p>}
      {!files && !error && <div className="skeleton mt-2 h-32" aria-busy="true" />}

      {files && tab === "files" && (
        <>
          <div className="toolbar mt-3">
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={regex ? "Regular expression" : "Search file name"} aria-label="Search files" />
            <label><input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> Regex</label>
            <label><input type="checkbox" checked={orphansOnly} onChange={(e) => setOrphansOnly(e.target.checked)} /> Orphans only</label>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="largest">Largest</option>
              <option value="views">Most viewed</option>
              <option value="name">Name</option>
            </select>
          </div>

          <div className="toolbar mt-3" aria-live="polite">
            <span className="text-sm">{picked.size} selected · {visible.length} shown</span>
            <button type="button" className={btn} disabled={!visible.length} onClick={toggleAll}>{allPicked ? "Clear selection" : "Select all shown"}</button>
            <button type="button" className={btn} disabled={busy || !orphans.length} onClick={() => setPicked(new Set(orphans.map((f) => f.id)))}>Select orphans</button>
            <button type="button" className={danger} disabled={busy || !picked.size} onClick={deleteChosen}>Delete selected</button>
            <input value={albumTitle} onChange={(e) => setAlbumTitle(e.target.value)} placeholder="New album title" aria-label="Album title" maxLength={200} />
            <button type="button" className={btn} disabled={busy || !picked.size || !albumTitle.trim()} onClick={createAlbum}>Create album</button>
          </div>

          <div className="table-wrap mt-2">
            <table className="data-table">
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Select all shown" checked={allPicked} onChange={toggleAll} /></th>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Views</th>
                  <th>Uploaded</th>
                  <th>Used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((f) => (
                  <tr key={f.id}>
                    <td><input type="checkbox" aria-label={`Select ${f.name}`} checked={picked.has(f.id)} onChange={() => toggle(f.id)} /></td>
                    <td style={{ overflowWrap: "anywhere" }}><a href={f.url} target="_blank" rel="noreferrer">{f.name}</a></td>
                    <td style={{ whiteSpace: "nowrap" }}>{size(f.size ?? 0)}</td>
                    <td>{f.views ?? 0}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{when(f.date_upload)}</td>
                    <td>{used.has(f.url) ? "yes" : "orphan"}</td>
                    <td><button type="button" className={btn} onClick={() => copy(f.url)}>Copy link</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visible.length && <p className="mt-2 text-sm">No files match.</p>}
        </>
      )}

      {tab === "albums" && albums && (
        <div className="table-wrap mt-3">
          <table className="data-table">
            <thead>
              <tr><th>Title</th><th>Files</th><th>Created</th><th /></tr>
            </thead>
            <tbody>
              {albums.map((a) => (
                <tr key={a.id}>
                  <td style={{ overflowWrap: "anywhere" }}><a href={`https://pixeldrain.com/l/${a.id}`} target="_blank" rel="noreferrer">{a.title || a.id}</a></td>
                  <td>{a.file_count ?? "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{when(a.date_created)}</td>
                  <td>
                    <span className="toolbar">
                      <button type="button" className={btn} disabled={busy || !picked.size} title={picked.size ? "" : "Select files on the Files tab first"} onClick={() => run(() => adminApi("PUT", `/api/admin/evo/cdn/albums/${a.id}${q}`, { add: chosen.map((f) => f.id) }), "Files added")}>Add selected files</button>
                      <button type="button" className={btn} disabled={busy} onClick={() => copy(`https://pixeldrain.com/l/${a.id}`)}>Copy link</button>
                      <button
                        type="button"
                        className={btn}
                        disabled={busy}
                        onClick={() => {
                          const title = window.prompt?.("Album title", a.title)?.trim();
                          if (title) run(() => adminApi("PUT", `/api/admin/evo/cdn/albums/${a.id}${q}`, { title }), "Album renamed");
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className={danger}
                        disabled={busy}
                        onClick={async () => {
                          if (await confirm({ title: `Delete album “${a.title}”?`, body: "Only the album is deleted; its files stay on the CDN.", confirmLabel: "Delete album" }))
                            run(() => adminApi("DELETE", `/api/admin/evo/cdn/albums/${a.id}${q}`), "Album deleted");
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!albums.length && <p className="mt-2 text-sm">No albums yet. Select files on the Files tab and create one.</p>}
        </div>
      )}
    </>
  );
}
