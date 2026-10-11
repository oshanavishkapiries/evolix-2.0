import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { episodes, movies, reports, seasons, shows, users } from "@/db/schema";
import type { ReportKind, ReportStatus } from "@/lib/reports";

export type ReportRow = {
  id: string;
  kind: ReportKind;
  /** Admin-page id: the movie id, or the show id for shows and episodes. */
  titleId: string;
  title: string;
  /** e.g. "S1:E3 Pilot" for episodes. */
  context: string;
  reason: string;
  message: string;
  status: ReportStatus;
  reporter: string;
  createdAt: Date;
};

export async function listReports({ status, page, pageSize }: { status?: ReportStatus; page: number; pageSize: number }) {
  const where = status ? eq(reports.status, status) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: reports.id,
        reason: reports.reason,
        message: reports.message,
        status: reports.status,
        createdAt: reports.createdAt,
        reporter: users.email,
        movieId: reports.movieId,
        movieTitle: movies.title,
        showId: reports.showId,
        showName: shows.name,
        epShowId: seasons.showId,
        epShowName: sql<string | null>`(select name from shows s where s.id = ${seasons.showId})`,
        seasonNumber: seasons.seasonNumber,
        episodeNumber: episodes.episodeNumber,
        episodeName: episodes.name,
      })
      .from(reports)
      .innerJoin(users, eq(users.id, reports.userId))
      .leftJoin(movies, eq(movies.id, reports.movieId))
      .leftJoin(shows, eq(shows.id, reports.showId))
      .leftJoin(episodes, eq(episodes.id, reports.episodeId))
      .leftJoin(seasons, eq(seasons.id, episodes.seasonId))
      .where(where)
      .orderBy(desc(reports.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(reports).where(where),
  ]);
  const items: ReportRow[] = rows.map((r) => {
    const kind: ReportKind = r.movieId ? "movie" : r.showId ? "show" : "episode";
    return {
      id: r.id,
      kind,
      titleId: r.movieId ?? r.showId ?? r.epShowId ?? "",
      title: r.movieTitle ?? r.showName ?? r.epShowName ?? "(deleted)",
      context: kind === "episode" ? `S${r.seasonNumber}:E${r.episodeNumber}${r.episodeName ? ` ${r.episodeName}` : ""}` : "",
      reason: r.reason,
      message: r.message,
      status: r.status,
      reporter: r.reporter,
      createdAt: r.createdAt,
    };
  });
  return { items, total };
}

export async function reportCounts() {
  const rows = await db.select({ status: reports.status, n: count() }).from(reports).groupBy(reports.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<ReportStatus, number>>;
  return { open: by.open ?? 0, resolved: by.resolved ?? 0, dismissed: by.dismissed ?? 0 };
}

export async function setReportStatus(id: string, status: ReportStatus) {
  const [row] = await db
    .update(reports)
    .set({ status, resolvedAt: status === "open" ? null : new Date() })
    .where(eq(reports.id, id))
    .returning({ id: reports.id, status: reports.status });
  return row ?? null;
}
