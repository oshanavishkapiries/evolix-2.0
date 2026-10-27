import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { parseBody } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

/** Batch delete: files go from the CDN, and catalog sources pointing at them are removed. */
export const POST = adminRoute(async (req) => {
  const parsed = await parseBody(req, z.object({ urls: z.array(z.string().url().max(500)).min(1).max(200) }));
  if ("error" in parsed) return parsed.error;
  const res = await engineProxyFor(req, "POST", "/cdn/delete-many", { urls: parsed.data.urls });
  if (!res.ok) return res;
  const { data } = (await res.clone().json()) as { data?: { deleted?: string[] } };
  if (data?.deleted?.length) await db.delete(sources).where(inArray(sources.url, data.deleted));
  return res;
});
