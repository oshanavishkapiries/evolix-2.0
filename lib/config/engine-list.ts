/** Pure engine-list parser shared by registry validation and runtime selection. */
export type EngineRef = { id: string; url: string; name: string };

/** Stable id for an engine: its address. It survives reordering the list; changing the address makes it a new engine. */
export function engineIdFor(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `-${u.port}` : ""}${u.pathname.replace(/\/+$/, "").replace(/[^\w]+/g, "-")}`.toLowerCase();
  } catch {
    return url.replace(/[^\w]+/g, "-").toLowerCase();
  }
}

/** Parses EVO_ENGINES: a JSON array of URLs or {url, name}. A bare URL or a comma-separated list is accepted too, and so is a value wrapped in stray quotes. */
export function parseEngines(list: string): EngineRef[] {
  let text = list.trim();
  while (text.length > 1 && /^(["'])[\s\S]*\1$/.test(text)) text = text.slice(1, -1).trim();
  let raw: unknown;
  if (text.startsWith("[")) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("EVO_ENGINES must be a JSON array, e.g. [\"http://10.0.0.1:8000\", \"http://10.0.0.2:8000\"]");
    }
  } else {
    raw = text.split(/[,\s]+/).filter(Boolean);
  }
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("EVO_ENGINES must list at least one engine URL");
  const entries = raw.map((e) => {
    const entry = typeof e === "string" ? { url: e } : (e as { url?: unknown; name?: unknown });
    if (typeof entry.url !== "string" || !/^https?:\/\//.test(entry.url)) throw new Error(`EVO_ENGINES has an invalid engine URL: ${JSON.stringify(e)}`);
    try { new URL(entry.url); } catch { throw new Error("EVO_ENGINES has an invalid engine URL"); }
    return { url: entry.url, name: typeof entry.name === "string" ? entry.name : undefined };
  });
  const seen = new Set<string>();
  return entries.map((e) => {
    const url = e.url.replace(/\/+$/, "");
    const id = engineIdFor(url);
    if (seen.has(id)) throw new Error(`EVO_ENGINES lists ${url} twice`);
    seen.add(id);
    return { id, url, name: e.name ?? id };
  });
}

