import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { SupportConversation, SupportInboxItem, SupportMessage, SupportThread, SupportNotification } from "./types";

const rows = async <T>(query: SQL): Promise<T[]> => (await db.execute(query)).rows as T[];
const messageColumns = sql`id::float8 as id, text, sender_role as "senderRole", created_at::text as "createdAt", deleted_at::text as "deletedAt"`;

export async function readThread(userId: string, admin: boolean, cursor: { before?: number; after?: number; version?: string } = {}): Promise<SupportThread> {
  const [row] = await rows<SupportConversation & { revision: number; clearedThrough: number }>(sql`
    select c.id, u.id as "userId", c.status, c.revision,
      ${admin ? sql`0` : sql`coalesce(r.cleared_through_id, 0)::float8`} as "clearedThrough" ${admin ? sql`, u.email` : sql``}
    from users u left join support_conversations c on c.user_id = u.id
    left join support_read_states r on r.conversation_id = c.id and r.user_id = u.id where u.id = ${userId}`);
  if (!row?.id) return { conversation: null, messages: [], hasMore: false, ...(admin ? { recipientEmail: row?.email } : {}) };
  const { revision, clearedThrough, ...conversation } = row;
  const version = `${revision}:${clearedThrough}`;
  const reset = cursor.version !== undefined && cursor.version !== version;
  const before = reset ? undefined : cursor.before;
  const after = reset ? undefined : cursor.after;
  const messages = await rows<SupportMessage>(sql`
    select ${messageColumns} from support_messages where conversation_id = ${conversation.id}
    and id > ${clearedThrough}
    ${before ? sql`and id < ${before}` : sql``}
    ${after ? sql`and id > ${after}` : sql``}
    order by id ${after ? sql`asc` : sql`desc`} limit 51`);
  const hasMore = messages.length > 50;
  const page = messages.slice(0, 50);
  return { conversation, messages: after ? page : page.reverse(), hasMore, version, reset, clearedThrough };
}

/** The conversation row serializes sends, so IDs follow commit order within each chat.
 * The entire send is one SQL statement: conversation creation and message persistence cannot split. */
export async function sendMessage(userId: string, senderId: string, admin: boolean, text: string, clientId: string) {
  const [message] = await rows<SupportMessage>(sql`
    with conversation as (
      insert into support_conversations (user_id) values (${userId})
      on conflict (user_id) do update set
        status = case when exists (
          select 1 from support_messages m where m.conversation_id = support_conversations.id
          and m.sender_id = ${senderId} and m.client_id = ${clientId}
        ) then support_conversations.status else 'open' end,
        updated_at = now()
      returning id
    ), sent as (
      insert into support_messages (conversation_id, sender_id, sender_role, text, client_id)
      select id, ${senderId}, ${admin ? "admin" : "user"}, ${text}, ${clientId} from conversation
      on conflict (conversation_id, sender_id, client_id) do nothing
      returning ${messageColumns}
    )
    select * from sent union all
    select ${messageColumns} from support_messages where conversation_id = (select id from conversation)
      and sender_id = ${senderId} and client_id = ${clientId} and not exists (select 1 from sent)`);
  // A concurrent duplicate can be invisible to the statement snapshot after waiting for its row lock.
  if (message) return message;
  const [existing] = await rows<SupportMessage>(sql`select ${messageColumns} from support_messages
    where conversation_id = (select id from support_conversations where user_id = ${userId})
    and sender_id = ${senderId} and client_id = ${clientId}`);
  return existing;
}

export async function markRead(userId: string, readerId: string, through: number) {
  await db.execute(sql`
    insert into support_read_states (conversation_id, user_id, last_message_id)
    select c.id, ${readerId}, m.id from support_conversations c
    join support_messages m on m.conversation_id = c.id where c.user_id = ${userId} and m.id = ${through}
    on conflict (conversation_id, user_id) do update
      set last_message_id = greatest(support_read_states.last_message_id, excluded.last_message_id)`);
}

export async function unreadCount(readerId: string, admin: boolean) {
  const [row] = await rows<{ count: number }>(sql`
    select count(*)::int as count from support_messages m
    join support_conversations c on c.id = m.conversation_id
    left join support_read_states r on r.conversation_id = c.id and r.user_id = ${readerId}
    where m.id > greatest(coalesce(r.last_message_id, 0), ${admin ? sql`0` : sql`coalesce(r.cleared_through_id, 0)`})
      and m.deleted_at is null and m.sender_role = ${admin ? "user" : "admin"}
    ${admin ? sql`` : sql`and c.user_id = ${readerId}`}`);
  return row.count;
}

export async function setStatus(userId: string, status: "open" | "resolved") {
  const result = await rows<{ id: string }>(sql`update support_conversations set status = ${status}, updated_at = now()
    where user_id = ${userId} returning id`);
  return result.length > 0;
}

export async function inbox(readerId: string, filter: string, search: string, before?: number) {
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const items = await rows<SupportInboxItem>(sql`
    select c.id, c.user_id as "userId", c.status, u.email,
      latest.id::float8 as "latestId", latest.text as "latestText", latest.sender_role as "latestRole",
      latest.created_at::text as "lastAt",
      (select count(*)::int from support_messages m where m.conversation_id = c.id
        and m.sender_role = 'user' and m.deleted_at is null and m.id > coalesce(r.last_message_id, 0)) as unread
    from support_conversations c join users u on u.id = c.user_id
    join lateral (select id, text, sender_role, created_at from support_messages where conversation_id = c.id and deleted_at is null order by id desc limit 1) latest on true
    left join support_read_states r on r.conversation_id = c.id and r.user_id = ${readerId}
    where u.email ilike ${pattern}
      ${filter === "needs_reply" ? sql`and c.status = 'open' and latest.sender_role = 'user'` : filter === "resolved" ? sql`and c.status = 'resolved'` : sql``}
      ${before ? sql`and latest.id < ${before}` : sql``}
    order by latest.id desc limit 31`);
  return { conversations: items.slice(0, 30), hasMore: items.length > 30 };
}

export async function findUsers(search: string) {
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  return rows<{ id: string; email: string }>(sql`select id, email from users where email ilike ${pattern} order by email limit 20`);
}

export async function userExists(userId: string) {
  return (await rows(sql`select id from users where id = ${userId}`)).length > 0;
}

export async function maySend(senderId: string, clientId: string) {
  if ((await rows(sql`select id from support_messages where sender_id = ${senderId} and client_id = ${clientId} limit 1`)).length) return true;
  const [row] = await rows<{ count: number }>(sql`select count(*)::int as count from support_messages
    where sender_id = ${senderId} and created_at > now() - interval '1 minute'`);
  return row.count < 30;
}

/** Keep the ID and retry key so a delayed send retry cannot restore deleted content. */
export async function deleteOwnMessage(userId: string, messageId: number) {
  const result = await rows<{ id: number }>(sql`
    with locked as (
      update support_conversations c set revision = revision + 1
      where c.user_id = ${userId} and exists (
        select 1 from support_messages m where m.conversation_id = c.id
        and m.id = ${messageId} and m.sender_id = ${userId} and m.sender_role = 'user'
      ) returning c.id
    )
    update support_messages set text = 'Message deleted', deleted_at = coalesce(deleted_at, now())
    where id = ${messageId} and conversation_id = (select id from locked) returning id::float8 as id`);
  return result.length > 0;
}

/** Clear only this participant's view, preserving the support team's conversation and later replies. */
export async function clearHistory(userId: string) {
  await db.execute(sql`
    with locked as (
      select id from support_conversations where user_id = ${userId} for update
    ), cutoff as (
      select c.id, coalesce(max(m.id), 0) as through from locked c
      left join support_messages m on m.conversation_id = c.id group by c.id
    )
    insert into support_read_states (conversation_id, user_id, last_message_id, cleared_through_id)
    select id, ${userId}, through, through from cutoff
    on conflict (conversation_id, user_id) do update set
      last_message_id = greatest(support_read_states.last_message_id, excluded.last_message_id),
      cleared_through_id = greatest(support_read_states.cleared_through_id, excluded.cleared_through_id)`);
}

export async function supportNotification(userId: string): Promise<SupportNotification> {
  const [row] = await rows<SupportMessage & { count: number }>(sql`
    select m.id::float8 as id, m.text, m.sender_role as "senderRole", m.created_at::text as "createdAt",
      (count(*) over ())::int as count
    from support_messages m join support_conversations c on c.id = m.conversation_id
    left join support_read_states r on r.conversation_id = c.id and r.user_id = ${userId}
    where c.user_id = ${userId} and m.sender_role = 'admin' and m.deleted_at is null
      and m.id > greatest(coalesce(r.last_message_id, 0), coalesce(r.cleared_through_id, 0))
    order by m.id desc limit 1`);
  if (!row) return { count: 0, latest: null };
  const { count, ...latest } = row;
  return { count, latest };
}
