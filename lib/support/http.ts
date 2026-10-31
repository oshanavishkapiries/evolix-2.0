import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, json as responseJson, parseBody } from "@/lib/auth/http";
import { markRead, maySend, readThread, sendMessage, setStatus } from "./store";

/** Chat histories and unread state must never be reused by a browser or shared cache. */
export function privateJson(status: number, body: Parameters<typeof responseJson>[1] = {}) {
  const res = responseJson(status, body);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export const messageInput = z.object({ text: z.string().trim().min(1).max(2000), clientId: z.uuid() });
const cursor = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const readInput = z.object({ through: cursor });
export const uuid = (id: string) => z.uuid().safeParse(id).success;
export function parseCursor(value: string | null): number | undefined {
  return value === null ? undefined : cursor.parse(value);
}

export async function threadResponse(req: NextRequest, userId: string, admin: boolean) {
  try {
    const before = parseCursor(req.nextUrl.searchParams.get("before"));
    const after = parseCursor(req.nextUrl.searchParams.get("after"));
    if (before && after) return fail(400, "INVALID_CURSOR", "Use one message cursor at a time");
    return privateJson(200, await readThread(userId, admin, { before, after }));
  } catch (e) {
    if (e instanceof z.ZodError) return fail(400, "INVALID_CURSOR", "Invalid message cursor");
    throw e;
  }
}

export async function sendResponse(req: NextRequest, userId: string, senderId: string, admin: boolean) {
  const parsed = await parseBody(req, messageInput);
  if ("error" in parsed) return parsed.error;
  if (!(await maySend(senderId, parsed.data.clientId))) return fail(429, "RATE_LIMITED", "Please wait a minute before sending more messages");
  const message = await sendMessage(userId, senderId, admin, parsed.data.text, parsed.data.clientId);
  return privateJson(201, { sent: message });
}

export async function readResponse(req: NextRequest, userId: string, readerId: string) {
  const parsed = await parseBody(req, readInput);
  if ("error" in parsed) return parsed.error;
  await markRead(userId, readerId, parsed.data.through);
  return privateJson(200);
}

export async function statusResponse(req: NextRequest, userId: string) {
  const parsed = await parseBody(req, z.object({ status: z.enum(["open", "resolved"]) }));
  if ("error" in parsed) return parsed.error;
  return await setStatus(userId, parsed.data.status) ? privateJson(200) : fail(404, "NOT_FOUND", "Conversation not found");
}
