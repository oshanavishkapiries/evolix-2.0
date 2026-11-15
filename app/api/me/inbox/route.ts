import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/session";
import { fail } from "@/lib/auth/http";
import { privateJson } from "@/lib/support/http";
import { supportNotification } from "@/lib/support/store";
import { inboxFor } from "@/lib/viewer/announcements";
import { summarizeInbox } from "./summary";

/** One session check for both notification badges. Never shared between users. */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const [unreadSupport, inbox] = await Promise.all([supportNotification(auth.userId), inboxFor(auth.userId)]);
  return privateJson(200, { unreadSupport, announcements: summarizeInbox(inbox) });
}
