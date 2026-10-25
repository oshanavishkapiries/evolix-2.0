// Announcement visibility, read receipts, scheduling and stats against the real DB.
//   npx tsx --env-file=.env tests/e2e/announcements.ts
// Creates throwaway users and announcements and deletes them afterwards.
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { announcements, users } from "@/db/schema";
import {
  announcementInput,
  createAnnouncement,
  duplicateAnnouncement,
  getAnnouncement,
  listAnnouncements,
  listReaders,
  publishAnnouncement,
  setArchived,
  updateAnnouncement,
} from "@/lib/cms/announcements";
import { inboxFor, markRead } from "@/lib/viewer/announcements";

const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !extra ? "" : `  (${extra})`}`);
  if (!ok) process.exitCode = 1;
};
const input = (o: Record<string, unknown> = {}) => announcementInput.parse({ title: "T", ...o });
const hour = 3600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

async function main() {
  const tag = `ann-${Date.now()}`;
  const made = await db
    .insert(users)
    .values(["a", "b", "c"].map((n) => ({ email: `${tag}-${n}@example.test`, passwordHash: "x" })))
    .returning();
  const [A, B, C] = made;
  const ids: string[] = [];
  const mk = async (o: Record<string, unknown>, publish = true) => {
    const r = await createAnnouncement(input(o), A.id, publish);
    ids.push(r.id);
    return r.id;
  };
  try {
    const all = await mk({ title: "Hello everyone" });
    const onlyB = await mk({ title: "Just B", audience: "users", recipients: [B.email] });
    const later = await mk({ title: "Scheduled", publishAt: iso(hour) });
    const gone = await mk({ title: "Short lived", publishAt: iso(-2 * hour), expiresAt: iso(-hour) });
    const draft = await mk({ title: "Draft" }, false);
    const admins = await mk({ title: "Admins only", audience: "admins" });

    const titles = async (u: string) => (await inboxFor(u)).items.map((i) => i.title).sort();
    check("everyone sees the open announcement", (await titles(A.id)).includes("Hello everyone"));
    check("only the addressed user sees targeted announcement", (await titles(B.id)).includes("Just B") && !(await titles(C.id)).includes("Just B"));
    check("scheduled, expired and draft are hidden", !(await titles(A.id)).some((t) => ["Scheduled", "Short lived", "Draft"].includes(t)));
    check("admins-only is hidden from regular users", !(await titles(A.id)).includes("Admins only"));

    const before = (await inboxFor(C.id)).unread;
    await markRead(C.id, { id: all });
    await markRead(C.id, { id: all });
    check("reading lowers unread by one, repeats are no-ops", (await inboxFor(C.id)).unread === before - 1);
    await markRead(C.id, { id: onlyB }); // not addressed to C
    check("cannot mark a hidden announcement read", (await inboxFor(C.id)).unread === before - 1);
    await markRead(C.id, { all: true });
    check("mark all as read clears unread", (await inboxFor(C.id)).unread === 0);

    const readers = await listReaders(all, { kind: "read", q: "", page: 1, pageSize: 50 });
    check("reader has a first-read time", !!readers?.users.find((u) => u.id === C.id)?.readAt);
    const unreadOnB = await listReaders(onlyB, { kind: "unread", q: "", page: 1, pageSize: 50 });
    check("unread list is limited to recipients", unreadOnB?.total === 1 && unreadOnB.users[0].id === B.id);
    const search = await listReaders(onlyB, { kind: "unread", q: `${tag}-b`, page: 1, pageSize: 50 });
    check("search narrows the list", search?.total === 1);

    const full = await getAnnouncement(onlyB);
    check("read rate counts recipients only", full?.recipientCount === 1 && full.readCount === 0);
    await markRead(B.id, { id: onlyB });
    check("recipient read is counted", (await getAnnouncement(onlyB))?.readCount === 1);

    // a user who signs up later still sees past announcements
    const [D] = await db.insert(users).values({ email: `${tag}-d@example.test`, passwordHash: "x" }).returning();
    made.push(D);
    check("late sign-up still sees earlier announcement", (await titles(D.id)).includes("Hello everyone"));

    // lifecycle
    check("draft publishes", !!(await publishAnnouncement(draft)) && (await titles(A.id)).includes("Draft"));
    await updateAnnouncement(draft, input({ title: "Draft fixed" }));
    check("published announcement can be corrected", (await titles(A.id)).includes("Draft fixed"));
    await setArchived(draft, true);
    check("archived is hidden from users but keeps stats", !(await titles(A.id)).includes("Draft fixed") && (await getAnnouncement(draft)) !== null);
    await setArchived(draft, false);
    check("unarchive restores it", (await titles(A.id)).includes("Draft fixed"));
    const copy = await duplicateAnnouncement(onlyB, A.id);
    ids.push(copy!.id);
    const copyFull = await getAnnouncement(copy!.id);
    check("duplicate becomes a draft with the same recipients", copyFull?.state === "draft" && copyFull.recipientEmails.length === 1 && copyFull.readCount === 0);

    const states = Object.fromEntries((await listAnnouncements({ page: 1, pageSize: 100 })).items.filter((i) => ids.includes(i.id)).map((i) => [i.title, i.state]));
    check("derived states", states["Scheduled"] === "scheduled" && states["Short lived"] === "expired" && states["Hello everyone"] === "live" && states["T (copy)".replace("T", "Just B")] === "draft", JSON.stringify(states));
    check("state filter", (await listAnnouncements({ state: "scheduled", page: 1, pageSize: 100 })).items.some((i) => i.id === later));
    check("unknown recipient email is rejected", await createAnnouncement(input({ audience: "users", recipients: ["nobody-here@example.test"] }), A.id, true).then(() => false, (e) => /No account/.test(e.message)));
    void gone; void admins;
  } finally {
    if (ids.length) await db.delete(announcements).where(inArray(announcements.id, ids));
    await db.delete(users).where(inArray(users.id, made.map((u) => u.id)));
  }
}
main().then(() => process.exit());
