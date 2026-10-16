import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { episodes, movies, seasons, sessions, shows, users, watchProgress } from "@/db/schema";
import { AutoRefresh } from "../_components/auto-refresh";
import { PageHeader } from "../_components/page-header";

const ACTIVE_MINUTES = 5;
const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const ago = (d: Date) => {
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
};

export default async function ActivityPage() {
  const rows = await db
    .select({
      id: watchProgress.id,
      email: users.email,
      at: watchProgress.updatedAt,
      position: watchProgress.positionSeconds,
      duration: watchProgress.durationSeconds,
      completed: watchProgress.completed,
      movie: movies.title,
      show: shows.name,
      season: seasons.seasonNumber,
      episode: episodes.episodeNumber,
    })
    .from(watchProgress)
    .innerJoin(users, eq(users.id, watchProgress.userId))
    .leftJoin(movies, eq(movies.id, watchProgress.movieId))
    .leftJoin(episodes, eq(episodes.id, watchProgress.episodeId))
    .leftJoin(seasons, eq(seasons.id, episodes.seasonId))
    .leftJoin(shows, eq(shows.id, seasons.showId))
    .orderBy(desc(watchProgress.updatedAt))
    .limit(150);

  const [online] = await db
    .select({ n: sql<number>`count(distinct ${sessions.userId})::int` })
    .from(sessions)
    .where(sql`${sessions.revokedAt} is null and ${sessions.expiresAt} > now() and ${sessions.createdAt} > now() - interval '30 days'`);

  const cutoff = Date.now() - ACTIVE_MINUTES * 60_000;
  const live = rows.filter((r) => r.at.getTime() >= cutoff);
  const title = (r: (typeof rows)[number]) => (r.movie ?? (r.show ? `${r.show} · S${r.season} E${r.episode}` : "Removed title"));
  const progress = (r: (typeof rows)[number]) => (r.duration ? `${clock(r.position)} / ${clock(r.duration)} (${Math.round((r.position / r.duration) * 100)}%)` : "—");

  const table = (list: typeof rows, empty: string) =>
    list.length ? (
      <div className="table-wrap mt-3">
        <table className="data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Watching</th>
              <th>Progress</th>
              <th>Last update</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td style={{ overflowWrap: "anywhere" }}>{r.email}</td>
                <td>{title(r)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.completed ? "finished" : progress(r)}</td>
                <td style={{ whiteSpace: "nowrap" }} title={fmt(r.at)}>{ago(r.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="mt-3 text-sm">{empty}</p>
    );

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title="Activity" />
      <p className="mt-2 text-sm">
        <strong>{live.length}</strong> watching now (updated in the last {ACTIVE_MINUTES} min) · <strong>{online?.n ?? 0}</strong> signed-in user(s) with a live session. Refreshes every 30 s.
      </p>
      <h2 className="mt-5 text-lg font-semibold">Watching now</h2>
      {table(live, "Nobody is watching right now.")}
      <h2 className="mt-6 text-lg font-semibold">Recent watch history</h2>
      {table(rows, "No playback recorded yet.")}
    </>
  );
}
