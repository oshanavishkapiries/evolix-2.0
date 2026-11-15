import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { settingTag } from "@/lib/viewer/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

/** Switches an admin can flip at runtime. `default` applies until one is saved. */
export const SETTINGS = {
  /** On: signed-in users can browse but cannot watch until an admin approves their account. */
  requireApproval: { default: false },
  /** On: the player occasionally asks viewers to rate their watching experience with an emoji. */
  playerFeedback: { default: true },
} as const;
export type SettingKey = keyof typeof SETTINGS;

export async function getSetting(key: SettingKey): Promise<boolean> {
  "use cache";
  cacheTag(settingTag(key));
  cacheLife({ stale: 0, revalidate: 60, expire: 300 });
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const value = typeof row?.value === "boolean" ? row.value : SETTINGS[key].default;
  return value;
}

export async function setSetting(key: SettingKey, value: boolean): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  revalidateTag(settingTag(key), { expire: 0 });
}
