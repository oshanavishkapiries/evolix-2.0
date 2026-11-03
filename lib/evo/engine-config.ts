/** Browser-safe registry, verified against the engine SPECS fixture. */
export type EngineValue = string | number | boolean;
export type EngineValues = Record<string, EngineValue>;
export type EngineConfigSpec = { key:string; label:string; description:string; group:string; kind:"int"|"float"|"choice"|"text"|"bool"|"url"|"secret"; min:number; max:number; live:boolean; choices:{value:string;label:string}[]; secret:boolean; restartNeeded:boolean };
export const ENGINE_CONFIG_SPECS: EngineConfigSpec[] = [
  {
    "key": "MAX_CONCURRENT_EXTRACTIONS",
    "label": "Parallel extractions",
    "description": "Headless-browser extractions running at once.",
    "kind": "int",
    "min": 1,
    "max": 8,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Capacity"
  },
  {
    "key": "MAX_CONCURRENT_DOWNLOADS",
    "label": "Parallel CDN caches",
    "description": "Downloads/uploads to the CDN running at once.",
    "kind": "int",
    "min": 1,
    "max": 8,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Capacity"
  },
  {
    "key": "MAX_QUEUED_TASKS",
    "label": "Queue limit",
    "description": "Jobs waiting for extraction beyond this are refused with 503.",
    "kind": "int",
    "min": 1,
    "max": 5000,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Capacity"
  },
  {
    "key": "MIN_FREE_DISK_GB",
    "label": "Minimum free disk (GB)",
    "description": "CDN caching is skipped below this much free disk.",
    "kind": "float",
    "min": 0,
    "max": 10000,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Capacity"
  },
  {
    "key": "BROWSER_POOL_SIZE",
    "label": "Browser pool size",
    "description": "Long-lived headless browsers shared by extractions. 0 = launch a fresh browser each time.",
    "kind": "int",
    "min": 0,
    "max": 8,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Browser"
  },
  {
    "key": "BROWSER_MAX_USES",
    "label": "Browser max uses",
    "description": "A pooled browser is replaced after this many extractions.",
    "kind": "int",
    "min": 1,
    "max": 1000,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Browser"
  },
  {
    "key": "BROWSER_RECYCLE_RSS_MB",
    "label": "Browser memory limit (MB)",
    "description": "A pooled browser using more memory than this is replaced. 0 = no limit.",
    "kind": "int",
    "min": 0,
    "max": 16000,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Browser"
  },
  {
    "key": "BLOCK_ASSETS",
    "label": "Block images, fonts and trackers",
    "description": "1 = provider pages skip images, fonts, media and ad/tracker hosts during extraction.",
    "kind": "int",
    "min": 0,
    "max": 1,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Browser"
  },
  {
    "key": "EXTRACTION_REUSE_TTL_S",
    "label": "Reuse extraction for (s)",
    "description": "Stream URLs from an extraction are reused for other qualities of the same title for this long. 0 = off.",
    "kind": "int",
    "min": 0,
    "max": 3600,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Providers"
  },
  {
    "key": "PROVIDER_FAIL_THRESHOLD",
    "label": "Provider failures before cool-down",
    "description": "Consecutive failures within the window that put a provider on cool-down. 0 = never skip providers.",
    "kind": "int",
    "min": 0,
    "max": 50,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Providers"
  },
  {
    "key": "PROVIDER_FAIL_WINDOW_S",
    "label": "Provider failure window (s)",
    "description": "Failures older than this no longer count towards a cool-down.",
    "kind": "int",
    "min": 10,
    "max": 86400,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Providers"
  },
  {
    "key": "PROVIDER_COOLDOWN_S",
    "label": "Provider cool-down (s)",
    "description": "How long a failing provider is skipped before one trial request.",
    "kind": "int",
    "min": 10,
    "max": 86400,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Providers"
  },
  {
    "key": "PROVIDER_MISS_THRESHOLD",
    "label": "\"Not found\" answers before cool-down",
    "description": "A provider that says \"title not found\" this many times in a row, without finding any title in between, is treated as broken. 0 = never.",
    "kind": "int",
    "min": 0,
    "max": 500,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Providers"
  },
  {
    "key": "EXTRACTOR_ORDER",
    "label": "Provider order",
    "description": "Which stream provider is tried first. The other one is the fallback when it fails or is cooling down.",
    "kind": "choice",
    "min": 0,
    "max": 0,
    "live": true,
    "choices": [
      {
        "value": "cinesrc,ythd",
        "label": "CineSrc first, then YtHD"
      },
      {
        "value": "ythd,cinesrc",
        "label": "YtHD first, then CineSrc"
      }
    ],
    "secret": false,
    "restartNeeded": false,
    "group": "Providers"
  },
  {
    "key": "YTHD_DECRYPTOR_CACHE",
    "label": "Cache YtHD decryptor",
    "description": "1 = keep the decryptor script on disk by version instead of downloading it every attempt.",
    "kind": "int",
    "min": 0,
    "max": 1,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Providers"
  },
  {
    "key": "TRANSLATE_MODEL",
    "label": "Translation model",
    "description": "OpenRouter model that translates subtitles to Sinhala (e.g. google/gemini-3.1-flash-lite). Takes effect on the next job.",
    "kind": "text",
    "min": 0,
    "max": 0,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Subtitles"
  },
  {
    "key": "TRANSLATE_DAILY_BUDGET_USD",
    "label": "Daily translation budget (USD)",
    "description": "0 = unlimited. Spend is always ledgered.",
    "kind": "float",
    "min": 0,
    "max": 100000,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Subtitles"
  },
  {
    "key": "CLEAN_ORPHANS_ON_START",
    "label": "Clean orphans on startup",
    "description": "Delete abandoned downloads on next startup.",
    "kind": "bool",
    "min": 0,
    "max": 1,
    "live": false,
    "choices": [],
    "secret": false,
    "restartNeeded": true,
    "group": "Callbacks and storage"
  },
  {
    "key": "TRANSLATE_CHUNK_CUES",
    "label": "Translation chunk cues",
    "description": "Cues per chunk on the next translation job.",
    "kind": "int",
    "min": 1,
    "max": 1000,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Subtitles"
  },
  {
    "key": "TRANSLATE_CONTEXT_CUES",
    "label": "Translation context cues",
    "description": "Context cues on the next translation job.",
    "kind": "int",
    "min": 0,
    "max": 1000,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Subtitles"
  },
  {
    "key": "TRANSLATE_CONCURRENCY",
    "label": "Translation concurrency",
    "description": "Parallel chunks on the next translation job.",
    "kind": "int",
    "min": 1,
    "max": 64,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Subtitles"
  },
  {
    "key": "EVO_WEBHOOK_URL",
    "label": "Completion webhook",
    "description": "HTTP(S) completion callback; empty disables callbacks.",
    "kind": "url",
    "min": 0,
    "max": 0,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Callbacks and storage"
  },
  {
    "key": "ERROR_REPORT_URL",
    "label": "Error reporting URL",
    "description": "HTTP(S) error callback; empty derives from the completion webhook.",
    "kind": "url",
    "min": 0,
    "max": 0,
    "live": true,
    "choices": [],
    "secret": false,
    "restartNeeded": false,
    "group": "Callbacks and storage"
  },
  {
    "key": "PIXELDRAIN_API_KEY",
    "label": "Pixeldrain API key",
    "description": "Used on the next storage call.",
    "kind": "secret",
    "min": 0,
    "max": 0,
    "live": true,
    "choices": [],
    "secret": true,
    "restartNeeded": false,
    "group": "Callbacks and storage"
  },
  {
    "key": "OPENROUTER_API_KEY",
    "label": "OpenRouter API key",
    "description": "Used on the next translation call.",
    "kind": "secret",
    "min": 0,
    "max": 0,
    "live": true,
    "choices": [],
    "secret": true,
    "restartNeeded": false,
    "group": "Subtitles"
  }
];
export const ENGINE_CONFIG_BY_KEY = new Map(ENGINE_CONFIG_SPECS.map(s => [s.key,s]));
export function validateEngineValue(key: string, value: unknown): EngineValue {
  const s = ENGINE_CONFIG_BY_KEY.get(key);
  if (!s) throw new Error("Unknown engine setting");
  const bad = (message: string): never => { throw new Error(`${key} ${message}`); };
  if (s.kind === "secret") return typeof value === "string" && value.length <= 16384 ? value : bad("must be a string of at most 16384 characters");
  if (s.kind === "url") {
    if (typeof value !== "string" || value.length > 4096) return bad("must be an HTTP(S) URL or empty");
    const text = value.trim(); if (!text) return "";
    try { const u = new URL(text); if (!/^https?:\/\/[^/]/i.test(text) || !/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password || /[\s\x00-\x1f]/.test(text)) return bad("must be an HTTP(S) URL or empty"); }
    catch { return bad("must be an HTTP(S) URL or empty"); }
    return text;
  }
  if (s.kind === "bool") {
    if (typeof value === "boolean") return value;
    if ([0,1,"0","1","true","false"].includes(value as string)) return [1,"1","true"].includes(value as string);
    return bad("must be a boolean");
  }
  if (s.kind === "text") { const text = typeof value === "string" ? value.trim() : ""; return text.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:~-]*$/.test(text) ? text : bad("must be an OpenRouter model id such as vendor/model-name"); }
  if (s.kind === "choice") return s.choices.some(c=>c.value === value) ? value as string : bad("must be one of: " + s.choices.map(c=>c.value).join(", "));
  if (typeof value !== "number" || !Number.isFinite(value)) return bad("must be a finite number");
  if (s.kind === "int" && !Number.isInteger(value)) return bad("must be a whole number");
  return value >= s.min && value <= s.max ? value : bad(`must be between ${s.min} and ${s.max}`);
}
export const mergeEngineConfig = (global: EngineValues, overrides: EngineValues): EngineValues => ({...global,...overrides});
export function diffEngineConfig(before: EngineValues, after: EngineValues): string[] { return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>before[k] !== after[k]); }
export function splitEngineConfig(config: EngineValues) {
  const values: EngineValues = {}, secrets: Record<string,string> = {};
  for (const [key,value] of Object.entries(config)) { const parsed = validateEngineValue(key,value); if (ENGINE_CONFIG_BY_KEY.get(key)!.secret) secrets[key] = parsed as string; else values[key] = parsed; }
  return {values,secrets};
}
export type ConfigSyncStatus = { state:"pending"|"in_sync"|"too_old"|"rejected"; lastError:string|null; lastAttemptAt:string|null; restartNeeded:string[]; version:number; pushedVersion:number; managed:boolean };
export function syncLabel(s: ConfigSyncStatus) { return !s.managed ? "Legacy mode" : s.state === "in_sync" ? `In sync v${s.version}` : s.state === "too_old" ? "Engine needs update" : s.state === "rejected" ? `Rejected: ${s.lastError ?? "Invalid configuration"}` : "Pending"; }
