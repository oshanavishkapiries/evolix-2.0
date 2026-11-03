import { createHmac } from "node:crypto";
import { getConfig } from "@/lib/config";

/** Signing key for invites and search choices, derived so these tokens can never double as login tokens. */
export const tokenKey = async () => new Uint8Array(createHmac("sha256", (await getConfig()).JWT_ACCESS_SECRET).update("subtitles:tokens:v1").digest());
