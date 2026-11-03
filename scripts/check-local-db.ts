import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db.execute(sql`SELECT 1 as num`);
  console.log("SELECT 1 executed via local Neon proxy:", JSON.stringify(result));
  const tables = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name != '__drizzle_migrations' ORDER BY table_name`
  );
  console.log(`Found ${tables.rows.length} tables via neon-http proxy path.`);
}

main().catch((err) => {
  console.error("Local DB check failed:", err);
  process.exit(1);
});
