import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, watchProgress } from "@/db/schema";
import { isAdminEmail } from "@/lib/auth/admin";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "../_components/page-header";
import { UserActions } from "../_components/user-actions";

const ago = (d: Date) => {
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
};
const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

export default async function UsersPage() {
  const last = db
    .select({
      userId: watchProgress.userId,
      at: sql<Date>`max(${watchProgress.updatedAt})`.as("at"),
      n: sql<number>`count(*)::int`.as("n"),
    })
    .from(watchProgress)
    .groupBy(watchProgress.userId)
    .as("last");
  const [rows, required] = await Promise.all([
    db
      .select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt, approvedAt: users.approvedAt, createdAt: users.createdAt, lastAt: last.at, titles: last.n })
      .from(users)
      .leftJoin(last, eq(last.userId, users.id))
      .orderBy(desc(users.createdAt))
      .limit(500),
    getSetting("requireApproval"),
  ]);
  const waiting = rows.filter((u) => !u.approvedAt && !isAdminEmail(u.email));
  return (
    <>
      <PageHeader title="Users" />
      <p className="mt-2 text-sm">
        Approval is <strong>{required ? "required" : "off"}</strong> (change it in Settings). {required ? `${waiting.length} user(s) cannot watch yet.` : "Everyone can watch right now."}
      </p>
      <div className="table-wrap mt-3">
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Email verified</th>
              <th>Approved to watch</th>
              <th>Last watched</th>
              <th>Titles</th>
              <th>Joined</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const admin = isAdminEmail(u.email);
              return (
                <tr key={u.id}>
                  <td style={{ overflowWrap: "anywhere" }}>
                    <Link href={`/admin/users/${u.id}`}>{u.email}</Link>
                    {admin && <div className="text-xs">admin</div>}
                  </td>
                  <td>{u.emailVerifiedAt ? "yes" : "no"}</td>
                  <td>{admin || u.approvedAt ? "yes" : "no"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{u.lastAt ? ago(new Date(u.lastAt)) : "never"}</td>
                  <td>{u.titles ?? 0}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmt(u.createdAt)}</td>
                  <td>{!admin && <UserActions id={u.id} approved={Boolean(u.approvedAt)} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
