import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

/** Switches an admin can flip at runtime. `default` applies until one is saved. */
export const SETTINGS = {
  /** On: signed-in users can browse but cannot watch until an admin approves their account. */
  requireApproval: { default: false },
} as const;
export type SettingKey = keyof typeof SETTINGS;

const TTL_MS = 5000;
const cache = new Map<string, { at: number; value: boolean }>();

export async function getSetting(key: SettingKey): Promise<boolean> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const value = typeof row?.value === "boolean" ? row.value : SETTINGS[key].default;
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function setSetting(key: SettingKey, value: boolean): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  cache.delete(key);
}
