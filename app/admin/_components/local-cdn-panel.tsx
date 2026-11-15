"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { useVisibleInterval } from "@/lib/client/use-visible-interval";
import { useConfirm } from "./confirm-dialog";
import { useToast } from "./toast";
import { TZ } from "@/lib/tz";

type Pool = { used_bytes: number; quota_bytes: number; file_count: number; oldest: number | null };
export type LocalCdnUsage = { provider: "local" | "pixeldrain" | "unknown"; videos?: Pool; subtitles?: Pool };
const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(2);

export function LocalCdnPanel({ engine, name }: { engine: string; name: string }) {
  const [usage, setUsage] = useState<LocalCdnUsage>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm(), toast = useToast();
  const query = `?engine=${encodeURIComponent(engine)}`;
  const load = useCallback(async () => {
    const res = await adminApi<{ data: LocalCdnUsage }>("GET", `/api/admin/evo/cdn/local/usage${query}`);
    if (res.ok) { setUsage(res.data); setError(""); }
    else setError(errorText(res));
  }, [query]);
  useVisibleInterval(load, 30_000, true, load);
  const purge = async () => {
    if (!await confirm({ title: `Purge local CDN on ${name}?`, body: "Delete all local videos and subtitles except files currently playing. Missing copies will need to be cached again on next play.", confirmLabel: "Purge local files" })) return;
    setBusy(true);
    const res = await adminApi<{ data: { deleted: number; pinned: number } }>("POST", `/api/admin/evo/cdn/local/purge${query}`);
    setBusy(false);
    if (!res.ok) { toast.error(errorText(res)); return; }
    toast.success(`${res.data.deleted} files deleted; ${res.data.pinned} playing files retained`);
    await load();
  };
  return <section className="stat mt-4" aria-label={`Local disk CDN: ${name}`}>
    <h2 className="text-base">Local disk CDN · {name}</h2>
    {error && <p role="alert">{error}</p>}
    {!usage && !error && <p>Loading usage…</p>}
    {usage?.provider === "pixeldrain" && <p className="text-sm">Inactive: this engine uses Pixeldrain. Any files retained on local disk are shown below.</p>}
    {usage?.provider === "unknown" && <p className="text-sm">Update this engine to enable local disk CDN usage reporting.</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      {(["videos", "subtitles"] as const).map((key) => {
        const pool = usage?.[key];
        return pool && <div key={key}>
          <h3 className="text-sm">{key === "videos" ? "Videos" : "Subtitles"}</h3>
          <p className="text-sm">{gb(pool.used_bytes)} / {gb(pool.quota_bytes)} GB · {pool.file_count} files</p>
          <progress className="w-full" aria-label={`${name} ${key} usage`} value={Math.min(pool.used_bytes, pool.quota_bytes || 1)} max={pool.quota_bytes || 1} />
          <p className="text-sm">Oldest access: {pool.oldest == null ? "No files" : new Date(pool.oldest * 1000).toLocaleString("en-GB", { timeZone: TZ })}</p>
        </div>;
      })}
    </div>
    <div className="toolbar mt-3">
      <Link href={`/admin/config/engines/${encodeURIComponent(engine)}`}>Settings → Configuration</Link>
      <button type="button" className="btn-secondary rounded-md border px-3 py-1.5 text-sm" onClick={load}>Refresh usage</button>
      <button type="button" className="btn-danger rounded-md border px-3 py-1.5 text-sm" disabled={busy || !usage?.videos || !!error} onClick={purge}>{busy ? "Purging…" : "Purge"}</button>
    </div>
  </section>;
}
