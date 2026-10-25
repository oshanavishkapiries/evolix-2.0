// Safety net for the multi-engine e2e scripts, which register fake CDN files (".../api/file/stub...") in the app's database.
//   node tests/e2e/evo_db.mjs guard <tmdbId...>     exit 1 if any of these movies already exists with a source or subtitle that is not a test stub
//   node tests/e2e/evo_db.mjs cleanup <isoStart>    remove what a run started at <isoStart> created: stub sources/subtitles, movies created since
//                                                   (and unused by any viewer), and the evo_* rows made since.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = Object.fromEntries(readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sql = neon(env.DATABASE_URL);
const [cmd, ...args] = process.argv.slice(2);

if (cmd === "guard") {
  const ids = args.map(Number);
  const hit = await sql.query(
    `select m.tmdb_id, m.title from movies m where m.tmdb_id = any($1)
       and (exists (select 1 from sources s where s.movie_id = m.id and s.url not like '%/api/file/stub%')
         or exists (select 1 from subtitles t where t.movie_id = m.id and t.url not like '%/api/file/stub%'))`,
    [ids],
  );
  if (hit.length) {
    console.error(`Refusing to run: these titles already have real sources or subtitles that the test would overwrite: ${hit.map((h) => `${h.title} (${h.tmdb_id})`).join(", ")}. Pick other TMDB ids.`);
    process.exit(1);
  }
} else if (cmd === "cleanup") {
  const since = args[0];
  await sql.query("delete from sources where url like '%/api/file/stub%'");
  await sql.query("delete from subtitles where url like '%/api/file/stub%'");
  await sql.query(
    `delete from movies where created_at >= $1
       and not exists (select 1 from watch_progress w where w.movie_id = movies.id)
       and not exists (select 1 from bookmarks b where b.movie_id = movies.id)`,
    [since],
  );
  await sql.query("delete from evo_tasks where created_at >= $1", [since]);
  await sql.query("delete from evo_claims where updated_at >= $1", [since]);
  await sql.query("delete from evo_engines"); // health snapshots and load counters rebuild themselves on the next check
} else {
  console.error("usage: guard <tmdbId...> | cleanup <isoStart>");
  process.exit(2);
}
