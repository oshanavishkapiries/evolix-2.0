# Support chat

The viewer's `/support` page is a private conversation with the Evolix team. It is linked from the desktop navigation and directly from the mobile bottom bar. The admin inbox is at `/admin/support`; admins can also open a chat from a user's profile.

## Behavior

- One persistent conversation per user; either side can start it. Reading an empty chat does not create a record.
- Signed-in users can contact support while waiting for watch approval. Every API verifies the current session; inbox operations require the existing verified admin allow-list.
- The server derives ownership and sender role from authentication. Viewer responses omit admin account IDs and emails.
- Messages are plain text, 1–2,000 characters. Failed sends retain the draft and retry ID. An atomic database statement saves each send; a unique constraint prevents retries from duplicating messages.
- Admins can filter All, Needs reply, and Resolved, search by email, and resolve/reopen a conversation. A new message reopens it. Reading does not remove a thread from Needs reply; an admin reply does.
- Read cursors are per participant, advance monotonically, and only accept messages in that conversation. Each admin has their own unread state. New messages remain unread while the viewer is reading older history.
- Users can delete their own outgoing messages after confirmation. The message text is overwritten with a deletion placeholder for both sides; the message ID and retry key remain so a delayed send retry cannot restore its content. Users cannot delete support replies or another user's messages.
- Clear history hides the conversation through the current last message on all of the user's devices and clears its unread count. It preserves the admin copy. Replies sent after that point remain visible and generate notifications. The confirmation explains this behavior.
- The existing notification bell includes a grouped preview of unread support replies alongside announcements. Opening the bell does not mark replies read; opening and reading the chat, or explicitly choosing Mark all as read, does. Counts refresh when signing in, returning to the tab/window, and while browsing.
- Conversation revisions and per-user history cutoffs reset a client's message cache after deletion or clearing, including another open device. The screens fill the available application area and keep the composer anchored below a scrolling history.
- Messages are fetched in pages of 50; inbox pages contain 30 conversations. Sending is limited to 30 new messages per account per minute. Retrying an existing message is allowed.
- Visible chats refresh every 5 seconds, the inbox every 10 seconds, and navigation badges every 45 seconds. Polling pauses in hidden browser tabs. No websocket service, email notifications, or engine calls are involved.
- Times are displayed in Asia/Colombo. There is no promise of immediate replies or a misleading online indicator.

## Deployment

1. Apply migrations through `drizzle/0020_support_message_controls.sql` using the normal migration process (`pnpm db:migrate`). Migration 0019 adds the support tables; migration 0020 adds message deletion metadata, conversation revisions, and the per-user history cutoff.
2. Deploy the web application containing these changes. Apply the migration before exposing the new navigation; otherwise support endpoints cannot query their tables.
3. Check a user message, an admin reply, unread badges, and Resolve/Reopen with separate signed-in user/admin browsers.

No additional environment variables, external services, or Evo engine deployment are required. Automated tests exercise the migration against an isolated database. Apply it separately to each deployment's configured database before deploying the web application.

## Validation

- `pnpm test:support`: database and route tests use isolated in-memory PostgreSQL (PGlite), never `DATABASE_URL`.
- `pnpm test:support:e2e`: Playwright runs the real chat components in a Vite harness with intercepted API responses. Checks include mobile navigation, duplicate-safe retries, admin initiation/resolution, history pagination, and scroll/read behavior.
- `pnpm exec tsc --noEmit`, targeted ESLint, and `pnpm build` validate application integration.
