import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { json, fail } from "@/lib/auth/http";
import { getRawConfigForAdmin } from "./index";
import { configEntry } from "./registry";
import { configRepository } from "./repository";
import { setConfigBatch, resetConfig, rollbackConfig } from "./store";
import { configValidation, includesAdmin } from "./admin-view";
import { fallbackValue } from "./index";
import { bootstrapSummary } from "./bootstrap";
import { z } from "zod";

type Params = Record<string, string>;
/** Same cookie/session guard and JSON envelope as other admin routes; no exception details escape. */
export function configRoute(handler: (req: NextRequest, params: Params, actor: string) => Promise<NextResponse>) {
  return async (req: NextRequest, ctx: { params: Promise<Params> }) => {
    const admin = await requireAdmin(req);
    if (admin instanceof NextResponse) return admin;
    try { return await handler(req, await ctx.params, admin.email); }
    catch { return fail(500, "CONFIG_ERROR", "Configuration operation failed; no secret values are returned. Please retry."); }
  };
}
const snapshot = async () => ({ data: await getRawConfigForAdmin(), bootstrap: bootstrapSummary() });
export const configGet = configRoute(async () => json(200, await snapshot()));
export const configPut = configRoute(async (req, _params, actor) => {
  let body: unknown;
  try { body = await req.json(); } catch { return fail(400, "INVALID_BODY", "Request body must be valid JSON"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "VALIDATION_ERROR", "Expected a configuration key/value object");
  const errors: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(body)) {
    const error = configValidation(key, value);
    if (error) errors[key] = error;
    if (key === "ADMIN_EMAILS" && !includesAdmin(value, actor)) errors[key] = "Keep your own admin email in ADMIN_EMAILS to avoid signing yourself out.";
  }
  if (Object.keys(errors).length) return fail(422, "VALIDATION_ERROR", "Fix the highlighted settings", { errors });
  await setConfigBatch(body as Record<string, unknown>, actor);
  // Do not re-read auth after rotating JWT keys; authorization used the original session.
  return json(200, await snapshot());
});
export const configDelete = configRoute(async (_req, { key }, actor) => {
  let entry;
  try { entry = configEntry(key); } catch { return fail(404, "NOT_FOUND", "Configuration key not found"); }
  if (key === "ADMIN_EMAILS" && !includesAdmin(fallbackValue("ADMIN_EMAILS"), actor)) return fail(422, "VALIDATION_ERROR", "The .env/default admin list must include your email before resetting ADMIN_EMAILS");
  const fallbackError = configValidation(key, fallbackValue(entry.key));
  if (fallbackError) return fail(422, "VALIDATION_ERROR", "Cannot reset: configure a valid .env/default value first", { errors: { [key]: fallbackError } });
  await resetConfig(entry.key, actor);
  return json(200, await snapshot());
});
export const configAuditGet = configRoute(async (req) => {
  const query = req.nextUrl.searchParams;
  const key = query.get("key") || undefined;
  if (key) { try { configEntry(key); } catch { return fail(400, "VALIDATION_ERROR", "Unknown key filter"); } }
  const limit = Number(query.get("limit") ?? 25);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail(400, "VALIDATION_ERROR", "Limit must be 1–100");
  let before;
  if (query.has("before")) {
    try { const parsed = JSON.parse(Buffer.from(query.get("before")!, "base64url").toString()); if (!z.uuid().safeParse(parsed.id).success || !Number.isFinite(Date.parse(parsed.at))) throw new Error(); before = { id: parsed.id as string, at: new Date(parsed.at) }; }
    catch { return fail(400, "VALIDATION_ERROR", "Invalid history cursor"); }
  }
  const rows = await configRepository.listAudit({ key, limit: limit + 1, before });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return json(200, { data: page.map((row) => {
    const secret = configEntry(row.key).secret;
    return { ...row, oldValue: secret && row.oldValue !== null ? "••••" : row.oldValue, newValue: secret && row.newValue !== null ? "••••" : row.newValue, canRollback: !secret && row.oldValue !== null, reason: secret ? "Secrets cannot be restored from masked history. Replace the secret instead." : row.oldValue === null ? "No previous value" : undefined };
  }), next: rows.length > limit && last ? Buffer.from(JSON.stringify({ at: last.at.toISOString(), id: last.id })).toString("base64url") : null });
});
export const configRollback = configRoute(async (_req, { id }, actor) => {
  if (!z.uuid().safeParse(id).success) return fail(400, "VALIDATION_ERROR", "Invalid audit ID");
  const row = await configRepository.auditById(id);
  if (!row || row.scope !== "app") return fail(404, "NOT_FOUND", "Audit entry not found");
  if (configEntry(row.key).secret) return fail(422, "VALIDATION_ERROR", "Secrets cannot be rolled back: history contains masked values only");
  if (row.oldValue === null) return fail(422, "VALIDATION_ERROR", "No previous value to restore");
  if (row.key === "ADMIN_EMAILS" && !includesAdmin(JSON.parse(row.oldValue), actor)) return fail(422, "VALIDATION_ERROR", "Rollback refused: the previous ADMIN_EMAILS must include your own email");
  await rollbackConfig(id, actor);
  return json(200, await snapshot());
});
