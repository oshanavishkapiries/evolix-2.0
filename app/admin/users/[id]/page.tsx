import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, movies, seasons, shows, users, watchProgress } from "@/db/schema";
import { isAdminEmail } from "@/lib/auth/admin";
import { PageHeader } from "../../_components/page-header";
import { UserActions } from "../../_components/user-actions";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) notFound();
  const history = await db
    .select({
      id: watchProgress.id,
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
    .leftJoin(movies, eq(movies.id, watchProgress.movieId))
    .leftJoin(episodes, eq(episodes.id, watchProgress.episodeId))
    .leftJoin(seasons, eq(seasons.id, episodes.seasonId))
    .leftJoin(shows, eq(shows.id, seasons.showId))
    .where(eq(watchProgress.userId, id))
    .orderBy(desc(watchProgress.updatedAt))
    .limit(200);
  const admin = isAdminEmail(user.email);
  return (
    <>
      <PageHeader title={user.email} />
      <p className="mt-2 text-sm">
        <Link href="/admin/users">← All users</Link> · Joined {fmt(user.createdAt)} · Email {user.emailVerifiedAt ? "verified" : "not verified"} ·{" "}
        {admin ? "admin" : user.approvedAt ? `approved ${fmt(user.approvedAt)}` : "not approved"}
      </p>
      {!admin && (
        <div className="mt-3">
          <UserActions id={user.id} approved={Boolean(user.approvedAt)} />
        </div>
      )}
      <h2 className="mt-5 text-lg font-semibold">Watch history ({history.length})</h2>
      {history.length ? (
        <div className="table-wrap mt-3">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Progress</th>
                <th>Last watched</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{h.movie ?? (h.show ? `${h.show} · S${h.season} E${h.episode}` : "Removed title")}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{h.completed ? "finished" : h.duration ? `${clock(h.position)} / ${clock(h.duration)} (${Math.round((h.position / h.duration) * 100)}%)` : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmt(h.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm">Nothing watched yet.</p>
      )}
    </>
  );
}
