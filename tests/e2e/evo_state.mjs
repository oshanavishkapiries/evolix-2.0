// Prints which engine owns the given tasks, as recorded in the app's database: {taskId: engineId|null}
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = Object.fromEntries(readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sql = neon(env.DATABASE_URL);
const ids = process.argv.slice(2);
const rows = ids.length ? await sql.query("select task_id, engine_id from evo_tasks where task_id = any($1)", [ids]) : [];
console.log(JSON.stringify(Object.fromEntries(ids.map((id) => [id, rows.find((r) => r.task_id === id)?.engine_id ?? null]))));
