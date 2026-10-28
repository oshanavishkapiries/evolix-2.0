import { createHmac } from "node:crypto";
import { env } from "@/lib/env";

/** Signing key for invites and search choices, derived so these tokens can never double as login tokens. */
export const tokenKey = () => new Uint8Array(createHmac("sha256", env.JWT_ACCESS_SECRET).update("subtitles:tokens:v1").digest());
