import { PROBLEMS, isProblemCode, type ProblemCode } from "@/lib/evo/problems";

/** A problem ready to show a viewer: friendly title and sentence, plus what the server suggested. */
export type ViewerProblem = { code: ProblemCode; title: string; message: string; retryAfter?: number; ref?: string };

export const problemOf = (code: ProblemCode, extra: Partial<ViewerProblem> = {}): ViewerProblem =>
  ({ code, title: PROBLEMS[code].title, message: PROBLEMS[code].message, ...extra });

/** Builds a problem from a route's JSON answer (an ingest/status error, or a FAILED task). Text we did not write is not trusted for `code`. */
export function problemFromBody(body: unknown, status = 500): ViewerProblem {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const retryAfter = typeof b.retryAfter === "number" ? b.retryAfter : undefined;
  const ref = text(b.ref);
  if (isProblemCode(b.code)) return problemOf(b.code, { title: text(b.title) ?? PROBLEMS[b.code].title, message: text(b.message) ?? PROBLEMS[b.code].message, retryAfter, ref });
  if (status === 429) return problemOf("RATE_LIMITED");
  // Plain answers such as "Your account is waiting for admin approval" are already written for viewers.
  if (status >= 400 && status < 500 && text(b.message)) return problemOf("UNKNOWN", { title: "Couldn’t start the stream", message: text(b.message)!, ref });
  return problemOf("UNKNOWN", { ref });
}

export async function readProblem(res: Response): Promise<ViewerProblem> {
  return problemFromBody(await res.json().catch(() => ({})), res.status);
}

/** The request never reached us (offline, or the connection dropped). */
export function networkProblem(): ViewerProblem {
  if (typeof navigator !== "undefined" && !navigator.onLine) return problemOf("OFFLINE");
  return problemOf("OFFLINE", { title: "Can’t reach our servers", message: "Check your internet connection and try again." });
}

/** One sentence for places that do not retry by themselves (the busy text promises "we’ll keep trying", which would be untrue there). */
export function problemText(p: ViewerProblem, retriesAutomatically = false): string {
  if (p.code === "BUSY" && !retriesAutomatically) return "We’re very busy right now. Please try again in a minute.";
  return p.message;
}
