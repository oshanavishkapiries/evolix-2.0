// Reads back what multi_engine.py created: sources per test title and recorded task ownership.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = Object.fromEntries(readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sql = neon(env.DATABASE_URL);
const tmdb = process.argv.slice(2).map(Number);
const sources = await sql.query("select m.tmdb_id, s.quality, s.engine_id from sources s join movies m on m.id = s.movie_id where m.tmdb_id = any($1)", [tmdb]);
const [{ n }] = await sql.query("select count(*)::int as n from evo_tasks");
console.log(JSON.stringify({ sources, tasks_recorded: n }));
