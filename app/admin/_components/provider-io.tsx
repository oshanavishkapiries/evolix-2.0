"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { errorText } from "@/lib/client/admin";
import { fetchWithRefresh } from "@/lib/client/api";
import { useToast } from "./toast";

type Row = {
  index: number;
  line: number | null;
  entry: "source" | "subtitle" | null;
  season: number | null;
  episode: number | null;
  url: string;
  status: "new" | "duplicate" | "error";
  message: string;
};
type Summary = {
  total: number;
  new: number;
  duplicates: number;
  errors: number;
  blank: number;
  sourcesNew: number;
  subtitlesNew: number;
};
type Preview = { summary: Summary; rows: Row[]; truncated: boolean };
type Result = { imported: { sources: number; subtitles: number }; skipped: number; blank: number; errors: number };

const BADGE = {
  new: "badge badge-on",
  duplicate: "badge badge-off",
  error: "badge bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
} as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Export template" menu and "Import" dialog for the sources and subtitles of one movie or show. */
export function ProviderIo({ kind, id }: { kind: "movie" | "show"; id: string }) {
  const api = `/api/admin/${kind}s/${id}`;
  const router = useRouter();
  const toast = useToast();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError("");
    if (input.current) input.current.value = "";
  }

  function onFile(f: File | null) {
    setFile(f);
    setPreview(null);
    setResult(null);
    setError("");
  }

  async function send(step: "preview" | "commit") {
    if (!file) return null;
    const body = new FormData();
    body.append("file", file);
    setBusy(step);
    setError("");
    try {
      const res = await fetchWithRefresh(`${api}/provider-import/${step}`, { method: "POST", body });
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
    const data = (await send("commit")) as Result | null;
    if (!data) return;
    setResult(data);
    setPreview(null);
    toast.success(
      `Imported ${plural(data.imported.sources, "source")} and ${plural(data.imported.subtitles, "subtitle")}`,
    );
    router.refresh();
  }

  const shown = preview ? preview.summary.total - preview.summary.blank : 0;

  return (
    <>
      <details ref={menu} className="relative">
        <summary className="btn-secondary cursor-pointer list-none">Export template</summary>
        <div className="absolute right-0 z-20 mt-1 flex w-32 flex-col rounded-md border border-gray-200 bg-white p-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {(["csv", "json"] as const).map((f) => (
            <a
              key={f}
              href={`${api}/provider-template?format=${f}`}
              download
              className="rounded px-3 py-2 text-gray-800 no-underline hover:bg-gray-100 hover:no-underline dark:text-gray-200 dark:hover:bg-gray-800"
              onClick={() => menu.current?.removeAttribute("open")}
            >
              {f.toUpperCase()}
            </a>
          ))}
        </div>
      </details>
      <button type="button" className="btn-secondary" onClick={() => dialog.current?.showModal()}>
        Import
      </button>

      <dialog
        ref={dialog}
        className="confirm-dialog import-dialog"
        aria-labelledby="provider-import-title"
        onClose={reset}
        onClick={(e) => {
          if (e.target === dialog.current && busy === null) dialog.current.close();
        }}
      >
        <div className="space-y-4">
          <h2 id="provider-import-title" className="text-lg">
            Import sources and subtitles
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Upload the template you exported from this {kind === "movie" ? "movie" : "show"}, with the provider columns
            filled in. Nothing is written until you confirm. Rows whose URL already exists are skipped, and rows with an
            empty URL are ignored.
          </p>
          <details>
            <summary>How the template works</summary>
            <div className="space-y-2 text-sm">
              <p>
                Fill in the provider columns (<code>label</code>, <code>kind</code>, <code>url</code>,{" "}
                <code>quality</code>, <code>audioLanguage</code> (si, en, ta, hi; the dub), <code>language</code> (subtitles), <code>format</code>) and leave the rest. Add more rows for the
                same {kind === "movie" ? "movie" : "episode"} by copying a row. Rows with an empty <code>url</code> are
                untouched placeholders.
              </p>
              {kind === "show" && (
                <p>
                  Do not change <code>seasonNumber</code> or <code>episodeNumber</code>: they decide where a row goes. Names
                  and <code>isVisible</code> are for reference only and are not imported.
                </p>
              )}
              <p>
                URLs must be absolute http(s); embeds must be https. Leave <code>sortOrder</code> empty to append after
                the existing entries. Maximum 2 MB and 5000 rows.
              </p>
            </div>
          </details>

          <div className="toolbar">
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
          {error && <p role="alert">{error}</p>}

          {result && (
            <p role="status">
              Imported {plural(result.imported.sources, "source")} and {plural(result.imported.subtitles, "subtitle")}.
              Skipped {plural(result.skipped, "duplicate")}, ignored {result.blank} blank, and {plural(result.errors, "row")}{" "}
              had errors.
            </p>
          )}

          {preview && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                  <small>already present</small>
                </div>
                <div className="stat">
                  <span className={BADGE.error}>Errors</span>
                  <strong>{preview.summary.errors}</strong>
                  <small>skipped</small>
                </div>
                <div className="stat">
                  <span className={BADGE.duplicate}>Blank</span>
                  <strong>{preview.summary.blank}</strong>
                  <small>ignored, no URL</small>
                </div>
              </div>

              {preview.summary.errors > 0 && (
                <p role="alert">
                  {plural(preview.summary.errors, "row")} with errors will be skipped. Only the valid new rows are
                  imported.
                </p>
              )}
              {preview.truncated && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Showing the first {preview.rows.length} of {shown} rows. The counts above cover the whole file.
                </p>
              )}

              {preview.rows.length > 0 && (
                <div className="table-wrap max-h-80 overflow-y-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Entry</th>
                        {kind === "show" && <th>Episode</th>}
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
                          {kind === "show" && (
                            <td className="whitespace-nowrap">
                              {r.season !== null && r.episode !== null ? `S${r.season}E${r.episode}` : "-"}
                            </td>
                          )}
                          <td className="max-w-64 break-all">{r.url || "-"}</td>
                          <td>
                            <span className={BADGE[r.status]}>{r.status}</span>
                          </td>
                          <td className="min-w-40 break-words">{r.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="toolbar justify-end pt-2">
            <button type="button" className="btn-secondary" disabled={busy === "commit"} onClick={() => dialog.current?.close()}>
              {result ? "Close" : "Cancel"}
            </button>
            {preview && (
              <button type="button" disabled={preview.summary.new === 0 || busy !== null} onClick={onCommit}>
                {busy === "commit" ? "Importing..." : `Import ${plural(preview.summary.new, "new row")}`}
              </button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
