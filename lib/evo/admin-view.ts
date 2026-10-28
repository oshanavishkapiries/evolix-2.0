/** What the Evo admin pages show, decided from plain data (pure, client-safe, unit tested). */

/** "oshan-evoengine-…-38-242-251-70.sslip.io" -> { label: "oshan", host: "38.242.251.70" }; anything else keeps its name. */
export function shortEngine(name: string, url: string): { label: string; host: string } {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {}
  const ip = /(\d{1,3})[-.](\d{1,3})[-.](\d{1,3})[-.](\d{1,3})(?:\.sslip\.io|\.nip\.io)?$/.exec(hostname);
  const host = ip ? ip.slice(1).join(".") : hostname || url;
  const label = /^([a-z0-9]+)-evo-?engine/i.exec(name)?.[1] ?? (name === hostname || name.includes(".") ? name.split(".")[0] : name);
  return { label, host };
}

/** Engine settings shown in groups, in this order. A key not listed here lands in "Other". */
export const SETTING_GROUPS: { title: string; hint: string; keys: string[] }[] = [
  { title: "Capacity", hint: "How much the engine does at once and when it says no.", keys: ["MAX_CONCURRENT_EXTRACTIONS", "MAX_CONCURRENT_DOWNLOADS", "MAX_QUEUED_TASKS", "MIN_FREE_DISK_GB"] },
  { title: "Providers", hint: "Which provider goes first and when a failing one is skipped.", keys: ["EXTRACTOR_ORDER", "PROVIDER_FAIL_THRESHOLD", "PROVIDER_FAIL_WINDOW_S", "PROVIDER_COOLDOWN_S", "PROVIDER_MISS_THRESHOLD", "EXTRACTION_REUSE_TTL_S", "YTHD_DECRYPTOR_CACHE"] },
  { title: "Browser", hint: "The headless browsers that open provider pages.", keys: ["BROWSER_POOL_SIZE", "BROWSER_MAX_USES", "BROWSER_RECYCLE_RSS_MB", "BLOCK_ASSETS"] },
  { title: "Subtitles", hint: "Sinhala translation spend. The model is chosen under OpenRouter.", keys: ["TRANSLATE_DAILY_BUDGET_USD"] },
];

export function groupSettings<T extends { key: string }>(settings: T[]): { title: string; hint: string; items: T[] }[] {
  const listed = new Set(SETTING_GROUPS.flatMap((g) => g.keys));
  const byKey = new Map(settings.map((s) => [s.key, s]));
  const groups = SETTING_GROUPS.map((g) => ({ title: g.title, hint: g.hint, items: g.keys.map((k) => byKey.get(k)).filter((s): s is T => !!s) }));
  const other = settings.filter((s) => !listed.has(s.key));
  return [...groups, { title: "Other", hint: "", items: other }].filter((g) => g.items.length);
}

export type ProviderState = { name: string; state: "healthy" | "cooling" | "trial"; cooling_until: number | null; recent_failures: number };
export type QueueState = { paused: boolean; waiting_extraction: number; extracting: number; caching: number; queue_limit: number };

export type EngineCard = {
  id: string;
  name: string;
  url: string;
  available: boolean;
  draining: boolean;
  safeToRemove: boolean;
  lastOkAt: string | null;
  lastError: string | null;
  activeJobs: number;
  queueDepth: number;
  freeDiskGb: number | null;
  failures: number | null;
  queue: QueueState | null;
  providers: ProviderState[] | null;
};

/** The one-word state an engine card and the engine page show. */
export function engineState(e: Pick<EngineCard, "available" | "draining" | "queue">): { tone: "ok" | "warn" | "bad"; text: string } {
  if (!e.available) return { tone: "bad", text: "Unavailable" };
  if (e.draining) return { tone: "warn", text: "Draining" };
  if (e.queue?.paused) return { tone: "warn", text: "Paused" };
  return { tone: "ok", text: "Available" };
}

export const providerName = (name: string) => name.replace(/StreamExtractor$/, "");

/** Below this much free disk an engine is flagged (the engine itself stops caching at its own MIN_FREE_DISK_GB). */
export const LOW_DISK_GB = 15;

export type Attention = { level: "bad" | "warn"; key: string; text: string; detail?: string; href?: string; engine?: string; provider?: string };

/** Things an admin should act on now, worst first. Empty means nothing needs them. */
export function attentionItems(engines: EngineCard[], stuck: { id: string; title: string; detail: string; href: string }[]): Attention[] {
  const out: Attention[] = [];
  for (const e of engines) {
    const { label } = shortEngine(e.name, e.url);
    if (!e.available) out.push({ level: "bad", key: `down:${e.id}`, text: `${label} is not answering`, detail: e.lastError ?? undefined, href: `/admin/evo/engines/${encodeURIComponent(e.id)}` });
    if (e.queue?.paused) out.push({ level: "warn", key: `paused:${e.id}`, text: `${label}: queue is paused`, detail: "Running jobs finish, no new ones start.", href: `/admin/evo/engines/${encodeURIComponent(e.id)}` });
    if (e.draining) out.push({ level: "warn", key: `drain:${e.id}`, text: `${label} is draining`, detail: e.safeToRemove ? "Empty: safe to remove from EVO_ENGINES." : "Finishing its jobs, takes no new ones.", href: `/admin/evo/engines/${encodeURIComponent(e.id)}` });
    if (e.freeDiskGb != null && e.freeDiskGb < LOW_DISK_GB) out.push({ level: "warn", key: `disk:${e.id}`, text: `${label}: only ${Math.round(e.freeDiskGb)} GB free disk`, href: `/admin/cdn?engine=${encodeURIComponent(e.id)}` });
    for (const p of e.providers ?? []) {
      if (p.state === "healthy") continue;
      out.push({ level: "warn", key: `prov:${e.id}:${p.name}`, text: `${providerName(p.name)} on ${label} is ${p.state === "cooling" ? "cooling down" : "waiting for a trial"}`, detail: p.state === "cooling" && p.cooling_until ? `until ${new Date(p.cooling_until * 1000).toLocaleTimeString("en-GB")}` : undefined, engine: e.id, provider: p.name });
    }
  }
  for (const s of stuck) out.push({ level: "bad", key: `stuck:${s.id}`, text: `${s.title}: viewers never got it`, detail: s.detail, href: s.href });
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1));
}

/** One line for the top of the page. */
export function healthLine(engines: EngineCard[]): { level: "ok" | "warn" | "bad"; text: string } {
  const up = engines.filter((e) => e.available).length;
  const level = up === 0 ? "bad" : up < engines.length || engines.some((e) => e.queue?.paused || e.providers?.some((p) => p.state !== "healthy")) ? "warn" : "ok";
  return { level, text: level === "ok" ? "All good" : level === "bad" ? "No engine is answering" : "Needs a look" };
}
