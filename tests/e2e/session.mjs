// Mints a short-lived signed-in session for the e2e tests and removes it again.
//   node tests/e2e/session.mjs create   -> prints "<sessionId> <accessToken>"
//   node tests/e2e/session.mjs delete <sessionId>
// Reads DATABASE_URL / JWT_ACCESS_SECRET from the root .env. Touches only the one session row it creates.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { SignJWT } from "jose";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const sql = neon(env.DATABASE_URL);
const [cmd, arg] = process.argv.slice(2);

if (cmd === "create") {
  const [user] = await sql.query("select id from users order by created_at limit 1");
  const sid = randomUUID();
  await sql.query("insert into sessions (id, user_id, refresh_token_hash, expires_at) values ($1, $2, $3, now() + interval '30 minutes')", [sid, user.id, `e2e-${sid}`]);
  const token = await new SignJWT({ sid }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuedAt().setExpirationTime("30m").sign(new TextEncoder().encode(env.JWT_ACCESS_SECRET));
  console.log(sid, token);
} else if (cmd === "delete" && arg) {
  await sql.query("delete from sessions where id = $1 and refresh_token_hash like 'e2e-%'", [arg]);
  // The watch page creates a source-less catalog row for the test title (TMDB 680); remove it if nothing else uses it.
  await sql.query("delete from movies m where m.tmdb_id = 680 and not exists (select 1 from sources s where s.movie_id = m.id) and not exists (select 1 from watch_progress w where w.movie_id = m.id) and not exists (select 1 from bookmarks b where b.movie_id = m.id)");
} else {
  console.error("usage: session.mjs create | delete <sessionId>");
  process.exit(2);
}
