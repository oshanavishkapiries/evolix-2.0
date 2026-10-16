"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";

const OFFERED = ["1080p", "720p", "480p"];
const POLL_MS = 3000;
const MAX_POLLS = (45 * 60_000) / POLL_MS;

type Status = { status?: string; message?: string; resolved_quality?: string; cache_failed?: boolean };

/**
 * Qualities the CDN does not hold yet can be requested: the engine fetches and caches that quality, then it shows up
 * in the source list. Only appears for titles that already have at least one cached quality.
 */
export function QualityRequest({ tmdbId, mediaType, season, episode, have }: { tmdbId: number; mediaType: "movie" | "tv"; season?: number; episode?: number; have: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const missing = OFFERED.filter((q) => !have.includes(q));
  if (!missing.length) return null;

  const post = (url: string, body?: unknown) =>
    fetchWithRefresh(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });

  async function request(quality: string) {
    setBusy(quality);
    setNote("Starting…");
    try {
      const res = await post("/api/evo/ingest", { tmdbId, mediaType, quality, season, episode });
      const task = (await res.json()) as { task_id?: string; error?: string; message?: string };
      if (!res.ok || !task.task_id) throw new Error(task.error ?? task.message ?? "Could not start");

      for (let i = 0; i < MAX_POLLS && alive.current; i++) {
        const st = (await (await post(`/api/evo/status/${task.task_id}`)).json()) as Status;
        if (st.status === "COMPLETED") {
          setNote(st.resolved_quality && st.resolved_quality !== quality ? `${quality} isn't available, added ${st.resolved_quality}` : `${quality} is ready`);
          router.refresh();
          return;
        }
        if (st.status === "FAILED" || st.cache_failed) throw new Error(st.message ?? "Caching failed");
        setNote(st.message ?? "Working…");
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (e) {
      if (alive.current) setNote(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  return (
    <div style={{ marginTop: ".75rem" }}>
      <p className="v-muted" style={{ fontSize: ".8rem", marginBottom: ".4rem" }}>Need another quality?</p>
      <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
        {missing.map((q) => (
          <button key={q} type="button" className="v-btn" disabled={busy !== null} onClick={() => request(q)}>
            {busy === q ? "Preparing…" : `Get ${q}`}
          </button>
        ))}
      </div>
      {note && (
        <p className="v-muted" role="status" style={{ fontSize: ".8rem", marginTop: ".4rem" }}>
          {note}
        </p>
      )}
    </div>
  );
}
