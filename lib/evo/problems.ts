/**
 * The plain-language problems viewers can meet while a video or subtitle is prepared.
 * One table, used by the server (to answer) and the browser (to show), so the wording never drifts.
 * Raw engine text never goes to a viewer: it stays in the error tracker and the admin pages.
 */
export type ProblemCode = "BUSY" | "ENGINE_UNAVAILABLE" | "NO_SOURCE" | "NOT_AIRED" | "RATE_LIMITED" | "SUBTITLES" | "OFFLINE" | "UNKNOWN";

type Entry = { title: string; message: string; retry: "auto" | "manual"; retryAfter?: number };

export const PROBLEMS: Record<ProblemCode, Entry> = {
  NOT_AIRED: { title: "Coming soon", message: "This episode hasn’t aired yet. Please come back on its scheduled air date.", retry: "manual" },
  BUSY: { title: "We’re very busy right now", message: "Lots of people are watching. We’ll keep trying for you.", retry: "auto", retryAfter: 20 },
  ENGINE_UNAVAILABLE: { title: "Our video service is restarting", message: "Please try again in a minute.", retry: "manual" },
  NO_SOURCE: { title: "No playable copy yet", message: "We couldn’t find a copy of this to play right now. Try again later, or pick another source.", retry: "manual" },
  RATE_LIMITED: { title: "Too many tries", message: "Please wait a little before trying again.", retry: "manual" },
  SUBTITLES: { title: "Subtitles aren’t ready", message: "We couldn’t get that subtitle right now. Try another one, or upload your own. Your video is not affected.", retry: "manual" },
  OFFLINE: { title: "You’re offline", message: "Check your internet connection. We’ll carry on when you’re back.", retry: "auto" },
  UNKNOWN: { title: "Something went wrong on our side", message: "We’ve been told about it. Please try again in a moment.", retry: "manual" },
};

export const SINHALA_FAILED = "Sinhala subtitles couldn’t be made right now. English subtitles keep working.";

export const isProblemCode = (v: unknown): v is ProblemCode => typeof v === "string" && Object.hasOwn(PROBLEMS, v);

/** Short reference a viewer can quote to support; the same value is stored with the error report. */
export const newRef = () => Math.random().toString(36).slice(2, 8).toUpperCase();

/** Which problem an engine failure text means. Order matters: the first matching rule wins. */
export function classifyFailure(raw: string | null | undefined): ProblemCode {
  const text = raw ?? "";
  if (/subtitle|translat|openrouter/i.test(text)) return "SUBTITLES";
  if (/busy|try again shortly|backlog/i.test(text)) return "BUSY";
  if (/did not answer|econn|fetch failed|engine .*unavailable/i.test(text)) return "ENGINE_UNAVAILABLE";
  if (/no streams? (found|urls)|extractors failed|no provider is available|failed to (resolve|extract|locate)|refused \(http|stream api returned|playlist|decrypt/i.test(text)) return "NO_SOURCE";
  return "UNKNOWN";
}

/** The JSON body a route answers with. `detail` is for admins and logs; routes serving viewers drop it. */
export function problemBody(code: ProblemCode, extra: { retryAfter?: number; ref?: string; detail?: string } = {}) {
  const p = PROBLEMS[code];
  const retryAfter = extra.retryAfter ?? p.retryAfter;
  return {
    code,
    title: p.title,
    message: p.message,
    // Kept so older clients that read `error` still show the friendly text.
    error: p.message,
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(extra.ref ? { ref: extra.ref } : {}),
    ...(extra.detail ? { detail: extra.detail } : {}),
  };
}

/** Reads the `Retry-After` header (seconds) the engine sends when it is full; clamped so an odd value cannot stall a viewer. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(120, Math.max(5, Math.round(n))) : undefined;
}

export const MAX_BUSY_RETRIES = 6;

/**
 * Seconds to wait before retry number `attempt` (0-based) while the servers are busy. It grows a little each time and
 * is jittered, so many waiting viewers do not all come back in the same second and make the queue worse.
 */
export function busyDelay(retryAfter: number | undefined, attempt: number, random: () => number = Math.random): number {
  const base = Math.min(120, Math.max(5, retryAfter ?? PROBLEMS.BUSY.retryAfter!));
  const grown = Math.min(60, base * (1 + attempt * 0.5));
  return Math.round(grown * (0.75 + random() * 0.5));
}
