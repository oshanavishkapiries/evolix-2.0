import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { episodes, seasons } from "@/db/schema";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound } from "@/lib/cms/api";

type P = { id: string };

const bulkVisibility = z.object({ isVisible: z.boolean() }).strict();

/** Shows or hides every episode of a season in one statement. */
export const PATCH = adminRoute<P>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Season");
  const body = await parseBody(req, bulkVisibility);
  if ("error" in body) return body.error;
  const [season] = await db.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, id)).limit(1);
  if (!season) return notFound("Season");
  const rows = await db
    .update(episodes)
    .set({ isVisible: body.data.isVisible })
    .where(eq(episodes.seasonId, id))
    .returning({ id: episodes.id });
  return json(200, { updated: rows.length });
});
