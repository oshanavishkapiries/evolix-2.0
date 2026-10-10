"use client";

import { useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import { errorText } from "@/lib/client/admin";
import { useConfirm } from "./confirm-dialog";
import { useToast } from "./toast";

type Row = {
  index: number;
  line: number | null;
  entry: "source" | "subtitle" | null;
  type: "movie" | "episode" | null;
  tmdbId: number | null;
  season: number | null;
  episode: number | null;
  title: string;
  url: string;
  status: "new" | "duplicate" | "error";
  message: string;
};
type Summary = { total: number; new: number; duplicates: number; errors: number; sourcesNew: number; subtitlesNew: number };
type Preview = { summary: Summary; rows: Row[]; truncated: boolean };
type Result = { imported: { sources: number; subtitles: number }; skipped: number; errors: number };

const CSV_EXAMPLE = `entry,type,tmdbId,season,episode,title,label,kind,url,quality,sortOrder,isActive,language,format
source,movie,603,,,The Matrix,Main server,hls,https://cdn.example.com/m.m3u8,1080p,0,true,,
subtitle,movie,603,,,The Matrix,English,,https://cdn.example.com/en.vtt,,0,,en,vtt
source,episode,1396,1,1,Breaking Bad,Embed,embed,https://player.example.com/e/1,,0,true,,`;

const JSON_EXAMPLE = `[
  {
    "type": "episode",
    "tmdbId": 1396,
    "season": 1,
    "episode": 1,
    "sources": [
      { "label": "Main", "kind": "direct", "url": "https://cdn.example.com/e1.mp4",
        "quality": "720p", "sortOrder": 0, "isActive": true }
    ],
    "subtitles": [
      { "label": "English", "language": "en", "url": "https://cdn.example.com/e1.vtt",
        "format": "vtt", "sortOrder": 0 }
    ]
  }
]`;

const BADGE = {
  new: "badge badge-on",
  duplicate: "badge badge-off",
  error: "badge bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
} as const;

const itemLabel = (r: Row) =>
  r.type === "episode"
    ? `${r.title} S${r.season}E${r.episode}`
    : r.title || (r.tmdbId ? `TMDB ${r.tmdbId}` : "-");

export function ImportExport() {
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);

  function onFile(f: File | null) {
    setFile(f);
    setPreview(null);
    setResult(null);
    setError("");
  }

  async function send(kind: "preview" | "commit") {
    if (!file) return null;
    const body = new FormData();
    body.append("file", file);
    setBusy(kind);
    setError("");
    try {
      const res = await fetchWithRefresh(`/api/admin/provider-data/import/${kind}`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorText({ ...data, ok: false, status: res.status }));
        return null;
      }
      return data;
    } catch {
      setError("Network error");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function onPreview() {
    setResult(null);
    const data = await send("preview");
    if (data) setPreview(data as Preview);
  }

  async function onCommit() {
    if (!preview) return;
    const { summary } = preview;
    const ok = await confirm({
      title: `Import ${summary.new} new row${summary.new === 1 ? "" : "s"}?`,
      body: (
        <>
          <p>
            {summary.sourcesNew} source{summary.sourcesNew === 1 ? "" : "s"} and {summary.subtitlesNew} subtitle
            {summary.subtitlesNew === 1 ? "" : "s"} will be added. Existing rows are not changed.
          </p>
          {summary.errors > 0 && (
            <p className="mt-2 font-medium">
              {summary.errors} row{summary.errors === 1 ? "" : "s"} with errors will be skipped.
            </p>
          )}
        </>
      ),
      confirmLabel: "Import",
      danger: false,
    });
    if (!ok) return;
    const data = (await send("commit")) as Result | null;
    if (!data) return;
    setResult(data);
    setPreview(null);
    toast.success(`Imported ${data.imported.sources} sources and ${data.imported.subtitles} subtitles`);
  }

  return (
    <div className="space-y-6">
      <section className="card">
        <h2>Export</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Downloads the sources and subtitles of every movie and episode that has any. Titles, images and
          trailers are not included.
        </p>
        <form method="get" action="/api/admin/provider-data/export" className="mt-3 toolbar">
          <label className="text-sm">
            Format{" "}
            <select name="format" defaultValue="json">
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <label className="text-sm">
            Include{" "}
            <select name="type" defaultValue="all">
              <option value="all">Movies and episodes</option>
              <option value="movies">Movies only</option>
              <option value="episodes">Episodes only</option>
            </select>
          </label>
          <button type="submit">Download</button>
        </form>
      </section>

      <section className="card">
        <h2>Import</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Adds sources and subtitles to titles already in the library, matched by TMDB id (episodes also by season
          and episode number). Nothing is written until you confirm. Entries whose URL already exists on the item
          are skipped.
        </p>
        <div className="mt-3 toolbar">
          <input
            ref={input}
            type="file"
            accept=".csv,.json"
            aria-label="File to import"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <button type="button" disabled={!file || busy !== null} onClick={onPreview}>
            {busy === "preview" ? "Checking..." : "Preview"}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3">
            {error}
          </p>
        )}

        {result && (
          <p role="status" className="mt-3">
            Imported {result.imported.sources} sources and {result.imported.subtitles} subtitles. Skipped{" "}
            {result.skipped} duplicate{result.skipped === 1 ? "" : "s"} and {result.errors} row
            {result.errors === 1 ? "" : "s"} with errors.
          </p>
        )}

        {preview && (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="stat">
                <span className={BADGE.new}>New</span>
                <strong>{preview.summary.new}</strong>
                <small>
                  {preview.summary.sourcesNew} sources, {preview.summary.subtitlesNew} subtitles
                </small>
              </div>
              <div className="stat">
                <span className={BADGE.duplicate}>Duplicates</span>
                <strong>{preview.summary.duplicates}</strong>
                <small>skipped, already present</small>
              </div>
              <div className="stat">
                <span className={BADGE.error}>Errors</span>
                <strong>{preview.summary.errors}</strong>
                <small>skipped, see messages</small>
              </div>
            </div>

            {preview.summary.errors > 0 && (
              <p role="alert">
                {preview.summary.errors} row{preview.summary.errors === 1 ? "" : "s"} with errors will be skipped.
                Only the valid new rows are imported.
              </p>
            )}
            {preview.truncated && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Showing the first {preview.rows.length} of {preview.summary.total} rows. The counts above cover the
                whole file.
              </p>
            )}

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Entry</th>
                    <th>Item</th>
                    <th>URL</th>
                    <th>Status</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.index} className={r.status === "error" ? "bg-red-50 dark:bg-red-950/40" : undefined}>
                      <td className="whitespace-nowrap">
                        {r.index}
                        {r.line !== null && <small className="block">line {r.line}</small>}
                      </td>
                      <td>{r.entry ?? "-"}</td>
                      <td className="min-w-40 break-words">{itemLabel(r)}</td>
                      <td className="max-w-64 break-all">{r.url || "-"}</td>
                      <td>
                        <span className={BADGE[r.status]}>{r.status}</span>
                      </td>
                      <td className="min-w-48 break-words">{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="toolbar">
              <button type="button" disabled={preview.summary.new === 0 || busy !== null} onClick={onCommit}>
                {busy === "commit" ? "Importing..." : `Import ${preview.summary.new} new row${preview.summary.new === 1 ? "" : "s"}`}
              </button>
              <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => {
                onFile(null);
                if (input.current) input.current.value = "";
              }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <details>
        <summary>File format</summary>
        <div className="space-y-3 text-sm">
          <p>
            Each entry is one source or subtitle. Items are matched by TMDB id; for episodes use the show&apos;s TMDB
            id plus <code>season</code> and <code>episode</code>. The <code>title</code> is informational and ignored.
            Leave <code>sortOrder</code> empty to append after the item&apos;s existing entries. URLs must be absolute
            http(s); embeds must be https. Maximum 2 MB and 5000 entries.
          </p>
          <h3>CSV</h3>
          <pre className="overflow-x-auto rounded-md bg-gray-100 p-3 text-xs dark:bg-gray-800">{CSV_EXAMPLE}</pre>
          <h3>JSON</h3>
          <pre className="overflow-x-auto rounded-md bg-gray-100 p-3 text-xs dark:bg-gray-800">{JSON_EXAMPLE}</pre>
          <p className="toolbar">
            <a className="btn-link" href="/api/admin/provider-data/export?template=1&format=csv">
              Download CSV template
            </a>
            <a className="btn-link" href="/api/admin/provider-data/export?template=1&format=json">
              Download JSON template
            </a>
          </p>
        </div>
      </details>
    </div>
  );
}
