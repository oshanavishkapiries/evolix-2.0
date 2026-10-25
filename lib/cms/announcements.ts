import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, lte, notExists, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { announcementReads, announcementRecipients, announcements, users } from "@/db/schema";
import { env } from "@/lib/env";
import {
  announcementState,
  AUDIENCE_KEYS,
  BODY_MAX,
  isSafeImage,
  isSafeLink,
  PRIORITY_KEYS,
  RECIPIENTS_MAX,
  TITLE_MAX,
  type AnnouncementAudience,
  type AnnouncementState,
} from "@/lib/announcements";

const date = z.union([z.iso.datetime({ offset: true }), z.literal("")]).nullish().transform((v) => (v ? new Date(v) : null));

export const announcementInput = z.object({
  title: z.string().trim().min(1, "A title is required").max(TITLE_MAX),
  body: z.string().trim().max(BODY_MAX).default(""),
  linkUrl: z.string().trim().max(500).nullish().transform((v) => v || null).refine((v) => v === null || isSafeLink(v), "Use a page of this app (/...) or an https:// address"),
  imageUrl: z.string().trim().max(1000).nullish().transform((v) => v || null).refine((v) => v === null || isSafeImage(v), "Use an https:// image address"),
  audience: z.enum(AUDIENCE_KEYS).default("everyone"),
  priority: z.enum(PRIORITY_KEYS).default("inbox"),
  publishAt: date,
  expiresAt: date,
  /** Emails of the recipients when the audience is "Specific users". */
  recipients: z.array(z.string().trim().toLowerCase().pipe(z.email())).max(RECIPIENTS_MAX).default([]),
});
export type AnnouncementInput = z.infer<typeof announcementInput>;

export class AnnouncementError extends Error {
  constructor(public path: string, message: string, public status = 400) {
    super(message);
  }
}

// ---- recipients and read counts (aggregate SQL, no per-user loops)

const adminList = () => {
  const list = env.adminEmails;
  return list.length ? sql`lower("users"."email") in (${sql.join(list.map((e) => sql`${e}`), sql`, `)})` : sql`false`;
};

/** Condition on `users` selecting who an announcement is addressed to. */
function addressedTo(a: { id: SQLWrapper | string; audience: SQLWrapper | AnnouncementAudience }): SQL {
  return sql`(
    ${a.audience} = 'everyone'
    or (${a.audience} = 'admins' and ${adminList()})
    or (${a.audience} = 'users' and exists (select 1 from announcement_recipients r where r.announcement_id = ${a.id} and r.user_id = "users"."id"))
  )`;
}

// Drizzle drops the table qualifier when a query has a single table, which would make these correlated
// subqueries resolve "id" to the inner users table; so the outer announcement is referenced by raw name.
const outer = { id: sql.raw('"announcements"."id"'), audience: sql.raw('"announcements"."audience"') };
// Built per query: the admin list comes from env, which is read on use.
const recipientCountSql = () => sql<number>`(select count(*)::int from users where ${addressedTo(outer)})`;
const readCountSql = () => sql<number>`(
  select count(*)::int from announcement_reads rd
  join users on users.id = rd.user_id
  where rd.announcement_id = ${outer.id} and ${addressedTo(outer)}
)`;

// ---- listing

const stateWhere = (state: AnnouncementState, now: Date): SQL | undefined => {
  switch (state) {
    case "draft":
      return eq(announcements.status, "draft");
    case "archived":
      return eq(announcements.status, "archived");
    case "scheduled":
      return and(eq(announcements.status, "published"), gt(announcements.publishAt, now));
    case "expired":
      return and(eq(announcements.status, "published"), lte(announcements.publishAt, now), lte(announcements.expiresAt, now));
    case "live":
      return and(eq(announcements.status, "published"), lte(announcements.publishAt, now), or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)));
  }
};

export type AnnouncementRow = {
  id: string;
  title: string;
  audience: AnnouncementAudience;
  priority: "inbox" | "banner";
  state: AnnouncementState;
  publishAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  recipients: number;
  reads: number;
};

export async function listAnnouncements({ state, page, pageSize }: { state?: AnnouncementState; page: number; pageSize: number }) {
  const now = new Date();
  const where = state ? stateWhere(state, now) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: announcements.id,
        title: announcements.title,
        audience: announcements.audience,
        priority: announcements.priority,
        status: announcements.status,
        publishAt: announcements.publishAt,
        expiresAt: announcements.expiresAt,
        createdAt: announcements.createdAt,
        recipients: recipientCountSql(),
        reads: readCountSql(),
      })
      .from(announcements)
      .where(where)
      .orderBy(desc(sql`coalesce(${announcements.publishAt}, ${announcements.createdAt})`))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(announcements).where(where),
  ]);
  const items: AnnouncementRow[] = rows.map(({ status, ...r }) => ({ ...r, state: announcementState({ status, publishAt: r.publishAt, expiresAt: r.expiresAt }, now) }));
  return { items, total };
}

export async function announcementCounts() {
  const now = new Date();
  const states = ["draft", "scheduled", "live", "expired", "archived"] as const;
  const counts = await Promise.all(states.map((s) => db.select({ n: count() }).from(announcements).where(stateWhere(s, now))));
  return Object.fromEntries(states.map((s, i) => [s, counts[i][0].n])) as Record<AnnouncementState, number>;
}

export async function getAnnouncement(id: string) {
  const [row] = await db
    .select({ a: announcements, recipients: recipientCountSql(), reads: readCountSql() })
    .from(announcements)
    .where(eq(announcements.id, id))
    .limit(1);
  if (!row) return null;
  const emails = row.a.audience === "users"
    ? (await db
        .select({ email: users.email })
        .from(announcementRecipients)
        .innerJoin(users, eq(users.id, announcementRecipients.userId))
        .where(eq(announcementRecipients.announcementId, id))
        .orderBy(asc(users.email))).map((r) => r.email)
    : [];
  return { ...row.a, state: announcementState(row.a), recipientEmails: emails, recipientCount: row.recipients, readCount: row.reads };
}

// ---- readers / non-readers

export async function listReaders(id: string, { kind, q, page, pageSize }: { kind: "read" | "unread"; q: string; page: number; pageSize: number }) {
  const [a] = await db.select({ id: announcements.id, audience: announcements.audience }).from(announcements).where(eq(announcements.id, id)).limit(1);
  if (!a) return null;
  const audienceCond = addressedTo({ id: a.id, audience: a.audience });
  const search = q ? ilike(users.email, `%${q.replace(/[%_\\]/g, "\\$&")}%`) : undefined;
  const readsFor = and(eq(announcementReads.announcementId, a.id), eq(announcementReads.userId, users.id));

  if (kind === "read") {
    const where = and(audienceCond, search);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({ id: users.id, email: users.email, readAt: announcementReads.readAt })
        .from(users)
        .innerJoin(announcementReads, readsFor)
        .where(where)
        .orderBy(desc(announcementReads.readAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(users).innerJoin(announcementReads, readsFor).where(where),
    ]);
    return { users: rows.map((r) => ({ id: r.id, email: r.email, readAt: r.readAt as Date | null })), total };
  }
  const where = and(audienceCond, search, notExists(db.select({ one: sql`1` }).from(announcementReads).where(readsFor)));
  const [rows, [{ total }]] = await Promise.all([
    db.select({ id: users.id, email: users.email }).from(users).where(where).orderBy(asc(users.email)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(users).where(where),
  ]);
  return { users: rows.map((r) => ({ ...r, readAt: null as Date | null })), total };
}

// ---- writes

async function resolveRecipients(emails: string[]) {
  const unique = [...new Set(emails)];
  if (!unique.length) return [];
  const found = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(sql`lower(${users.email})`, unique));
  const have = new Set(found.map((u) => u.email.toLowerCase()));
  const missing = unique.filter((e) => !have.has(e));
  if (missing.length) throw new AnnouncementError("recipients", `No account for: ${missing.join(", ")}`);
  return found.map((u) => u.id);
}

function checkDates(i: Pick<AnnouncementInput, "publishAt" | "expiresAt">, publishAt: Date | null) {
  if (i.expiresAt && publishAt && i.expiresAt <= publishAt) throw new AnnouncementError("expiresAt", "Expiry must be after the publish time");
  if (i.expiresAt && !publishAt && i.expiresAt <= new Date()) throw new AnnouncementError("expiresAt", "Expiry must be in the future");
}

async function setRecipients(id: string, audience: AnnouncementAudience, emails: string[]) {
  await db.delete(announcementRecipients).where(eq(announcementRecipients.announcementId, id));
  if (audience !== "users") return;
  const ids = await resolveRecipients(emails);
  if (ids.length) await db.insert(announcementRecipients).values(ids.map((userId) => ({ announcementId: id, userId })));
}

export async function createAnnouncement(input: AnnouncementInput, createdBy: string, publish: boolean) {
  const publishAt = publish ? (input.publishAt ?? new Date()) : input.publishAt;
  checkDates(input, publishAt);
  if (input.audience === "users") {
    if (!input.recipients.length && publish) throw new AnnouncementError("recipients", "Add at least one recipient");
    await resolveRecipients(input.recipients); // fail before writing anything
  }
  const [row] = await db
    .insert(announcements)
    .values({
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
      imageUrl: input.imageUrl,
      audience: input.audience,
      priority: input.priority,
      status: publish ? "published" : "draft",
      publishAt,
      expiresAt: input.expiresAt,
      createdBy,
    })
    .returning({ id: announcements.id });
  await setRecipients(row.id, input.audience, input.recipients);
  return row;
}

/** Edits a draft, or fixes a published one in place (read receipts stay). Publish time is kept once published. */
export async function updateAnnouncement(id: string, input: AnnouncementInput) {
  const [cur] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  if (!cur) return null;
  const publishAt = cur.status === "draft" ? input.publishAt : cur.publishAt;
  checkDates(input, publishAt);
  if (input.audience === "users") {
    if (!input.recipients.length && cur.status !== "draft") throw new AnnouncementError("recipients", "Add at least one recipient");
    await resolveRecipients(input.recipients);
  }
  await db
    .update(announcements)
    .set({
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
      imageUrl: input.imageUrl,
      audience: input.audience,
      priority: input.priority,
      publishAt,
      expiresAt: input.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(announcements.id, id));
  await setRecipients(id, input.audience, input.recipients);
  return { id };
}

/** Publishes a draft now, or at the time it was scheduled for. */
export async function publishAnnouncement(id: string) {
  const [cur] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  if (!cur) return null;
  if (cur.status !== "draft") throw new AnnouncementError("status", "Only drafts can be published", 409);
  if (cur.audience === "users") {
    const [{ n }] = await db.select({ n: count() }).from(announcementRecipients).where(eq(announcementRecipients.announcementId, id));
    if (!n) throw new AnnouncementError("recipients", "Add at least one recipient");
  }
  const publishAt = cur.publishAt && cur.publishAt > new Date() ? cur.publishAt : new Date();
  if (cur.expiresAt && cur.expiresAt <= publishAt) throw new AnnouncementError("expiresAt", "Expiry must be after the publish time");
  await db.update(announcements).set({ status: "published", publishAt, updatedAt: new Date() }).where(eq(announcements.id, id));
  return { id };
}

/** Hides it from users while keeping the stats; unarchiving puts a published one back. */
export async function setArchived(id: string, archived: boolean) {
  const [cur] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  if (!cur) return null;
  if (archived && cur.status === "archived") return { id };
  if (!archived && cur.status !== "archived") return { id };
  // Archived ones came from published (drafts cannot be archived), so restoring means published again.
  if (archived && cur.status === "draft") throw new AnnouncementError("status", "Drafts are deleted, not archived", 409);
  await db.update(announcements).set({ status: archived ? "archived" : "published", updatedAt: new Date() }).where(eq(announcements.id, id));
  return { id };
}

export async function duplicateAnnouncement(id: string, createdBy: string) {
  const full = await getAnnouncement(id);
  if (!full) return null;
  const [row] = await db
    .insert(announcements)
    .values({ title: `${full.title} (copy)`.slice(0, TITLE_MAX), body: full.body, linkUrl: full.linkUrl, imageUrl: full.imageUrl, audience: full.audience, priority: full.priority, status: "draft", createdBy })
    .returning({ id: announcements.id });
  if (full.audience === "users") await setRecipients(row.id, "users", full.recipientEmails.map((e) => e.toLowerCase()));
  return row;
}

/** Only drafts can be deleted; anything that was sent keeps its history. */
export async function deleteDraft(id: string) {
  const rows = await db.delete(announcements).where(and(eq(announcements.id, id), eq(announcements.status, "draft"))).returning({ id: announcements.id });
  return rows.length > 0;
}
