import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { episodes, movies, seasons, shows, sources, subtitles } from "@/db/schema";
import { fail } from "@/lib/auth/http";
import { sourceCreate, subtitleCreate } from "@/lib/cms/schemas";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ENTRIES = 5000;
export const MAX_PREVIEW_ROWS = 1000;
const INSERT_CHUNK = 500;

export type ItemType = "movie" | "episode";
export type EntryKind = "source" | "subtitle";
export type FileFormat = "csv" | "json";

const SOURCE_COLUMNS = ["label", "kind", "url", "quality", "sortOrder", "isActive"] as const;
const SUBTITLE_COLUMNS = ["label", "language", "url", "format", "sortOrder"] as const;
const IDENTITY_COLUMNS = ["entry", "type", "tmdbId", "season", "episode", "title"] as const;
export const CSV_COLUMNS = [
  ...IDENTITY_COLUMNS,
  "label",
  "kind",
  "url",
  "quality",
  "sortOrder",
  "isActive",
  "language",
  "format",
] as const;

// ------------------------------------------------------------------ export

type SourceOut = {
  label: string;
  kind: string;
  url: string;
  quality: string | null;
  sortOrder: number;
  isActive: boolean;
};
type SubtitleOut = { label: string; language: string; url: string; format: string; sortOrder: number };
export type ExportItem = {
  type: ItemType;
  tmdbId: number;
  season: number | null;
  episode: number | null;
  title: string;
  sources: SourceOut[];
  subtitles: SubtitleOut[];
};

const sourceOut = (r: SourceOut): SourceOut => ({
  label: r.label,
  kind: r.kind,
  url: r.url,
  quality: r.quality,
  sortOrder: r.sortOrder,
  isActive: r.isActive,
});
const subtitleOut = (r: SubtitleOut): SubtitleOut => ({
  label: r.label,
  language: r.language,
  url: r.url,
  format: r.format,
  sortOrder: r.sortOrder,
});

/** Every movie/episode with at least one source or subtitle; four queries, grouped in memory. */
export async function loadExportItems(scope: "all" | "movies" | "episodes"): Promise<ExportItem[]> {
  const wantMovies = scope !== "episodes";
  const wantEpisodes = scope !== "movies";
  const none = Promise.resolve([] as never[]);

  const [mSources, mSubs, eSources, eSubs] = await Promise.all([
    wantMovies
      ? db
          .select({ tmdbId: movies.tmdbId, title: movies.title, s: sources })
          .from(sources)
          .innerJoin(movies, eq(movies.id, sources.movieId))
          .orderBy(asc(sources.sortOrder), asc(sources.createdAt), asc(sources.id))
      : none,
    wantMovies
      ? db
          .select({ tmdbId: movies.tmdbId, title: movies.title, s: subtitles })
          .from(subtitles)
          .innerJoin(movies, eq(movies.id, subtitles.movieId))
          .orderBy(asc(subtitles.sortOrder), asc(subtitles.createdAt), asc(subtitles.id))
      : none,
    wantEpisodes
      ? db
          .select({
            tmdbId: shows.tmdbId,
            title: shows.name,
            season: seasons.seasonNumber,
            episode: episodes.episodeNumber,
            s: sources,
          })
          .from(sources)
          .innerJoin(episodes, eq(episodes.id, sources.episodeId))
          .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
          .innerJoin(shows, eq(shows.id, seasons.showId))
          .orderBy(asc(sources.sortOrder), asc(sources.createdAt), asc(sources.id))
      : none,
    wantEpisodes
      ? db
          .select({
            tmdbId: shows.tmdbId,
            title: shows.name,
            season: seasons.seasonNumber,
            episode: episodes.episodeNumber,
            s: subtitles,
          })
          .from(subtitles)
          .innerJoin(episodes, eq(episodes.id, subtitles.episodeId))
          .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
          .innerJoin(shows, eq(shows.id, seasons.showId))
          .orderBy(asc(subtitles.sortOrder), asc(subtitles.createdAt), asc(subtitles.id))
      : none,
  ]);

  const items = new Map<string, ExportItem>();
  const item = (
    type: ItemType,
    tmdbId: number,
    season: number | null,
    episode: number | null,
    title: string,
  ) => {
    const key = `${type}:${tmdbId}:${season}:${episode}`;
    let it = items.get(key);
    if (!it) {
      const label = type === "episode" ? `${title} S${pad(season!)}E${pad(episode!)}` : title;
      it = { type, tmdbId, season, episode, title: label, sources: [], subtitles: [] };
      items.set(key, it);
    }
    return it;
  };
  for (const r of mSources) item("movie", r.tmdbId, null, null, r.title).sources.push(sourceOut(r.s));
  for (const r of mSubs) item("movie", r.tmdbId, null, null, r.title).subtitles.push(subtitleOut(r.s));
  for (const r of eSources)
    item("episode", r.tmdbId, r.season, r.episode, r.title).sources.push(sourceOut(r.s));
  for (const r of eSubs)
    item("episode", r.tmdbId, r.season, r.episode, r.title).subtitles.push(subtitleOut(r.s));

  return [...items.values()].sort(
    (a, b) =>
      a.type.localeCompare(b.type) ||
      a.tmdbId - b.tmdbId ||
      (a.season ?? 0) - (b.season ?? 0) ||
      (a.episode ?? 0) - (b.episode ?? 0),
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Formula-injection guard: text cells starting with = + - @ tab or CR get a leading single quote. */
const DANGEROUS = /^[=+\-@\t\r]/;
const guard = (v: string) => (DANGEROUS.test(v) ? `'${v}` : v);
/** Inverse of `guard`: only strips a quote that was put in front of a dangerous character. */
const unguard = (v: string) => (v.startsWith("'") && DANGEROUS.test(v.slice(1)) ? v.slice(1) : v);

/** RFC 4180 cell. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? guard(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function buildJson(items: ExportItem[]): string {
  return JSON.stringify(items, null, 2) + "\n";
}

export function buildCsv(items: ExportItem[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  const push = (cells: Record<string, unknown>) =>
    lines.push(CSV_COLUMNS.map((c) => csvCell(cells[c])).join(","));
  for (const it of items) {
    const id = { type: it.type, tmdbId: it.tmdbId, season: it.season, episode: it.episode, title: it.title };
    for (const s of it.sources) push({ entry: "source", ...id, ...s });
    for (const s of it.subtitles) push({ entry: "subtitle", ...id, ...s });
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Small example file served as the downloadable template. */
export const TEMPLATE_ITEMS: ExportItem[] = [
  {
    type: "movie",
    tmdbId: 603,
    season: null,
    episode: null,
    title: "The Matrix",
    sources: [
      {
        label: "Main server",
        kind: "hls",
        url: "https://cdn.example.com/matrix/master.m3u8",
        quality: "1080p",
        sortOrder: 0,
        isActive: true,
      },
    ],
    subtitles: [
      {
        label: "English",
        language: "en",
        url: "https://cdn.example.com/matrix/en.vtt",
        format: "vtt",
        sortOrder: 0,
      },
    ],
  },
  {
    type: "episode",
    tmdbId: 1396,
    season: 1,
    episode: 1,
    title: "Breaking Bad S01E01",
    sources: [
      {
        label: "Embed",
        kind: "embed",
        url: "https://player.example.com/embed/bb-s01e01",
        quality: null,
        sortOrder: 0,
        isActive: true,
      },
    ],
    subtitles: [],
  },
];

// ------------------------------------------------------------------ parsing

/** One source/subtitle entry as read from the file, before validation. */
type RawEntry = {
  /** 1-based position among all entries in the file. */
  index: number;
  /** CSV only: line where the record starts. */
  line: number | null;
  entry: EntryKind | null;
  type: unknown;
  tmdbId: unknown;
  season: unknown;
  episode: unknown;
  title: unknown;
  fields: Record<string, unknown>;
  parseError?: string;
};

export class ImportFileError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Minimal RFC 4180 reader: quotes, escaped quotes, commas/newlines in cells, CRLF/LF/CR. */
export function parseCsv(input: string): { line: number; cells: string[] }[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let quotedCell = false;
  let line = 1;
  let startLine = 1;

  const endCell = () => {
    cells.push(cell);
    cell = "";
    quotedCell = false;
  };
  const endRecord = () => {
    endCell();
    // Skip blank lines.
    if (!(cells.length === 1 && cells[0] === "")) records.push({ line: startLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
    } else if (ch === '"' && cell === "" && !quotedCell) {
      inQuotes = true;
      quotedCell = true;
    } else if (ch === ",") {
      endCell();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      startLine = line;
    } else cell += ch;
  }
  if (inQuotes) throw new ImportFileError("CSV has an unterminated quoted cell");
  if (cell !== "" || cells.length > 0 || quotedCell) endRecord();
  return records;
}

const blank = (v: unknown) => v === undefined || v === null || v === "";

function csvToRaw(text: string): RawEntry[] {
  const records = parseCsv(text);
  if (records.length === 0) throw new ImportFileError("CSV file is empty");
  const header = records[0].cells.map((h) => h.trim().toLowerCase());
  const col = new Map<string, number>();
  for (const c of CSV_COLUMNS) {
    const at = header.indexOf(c.toLowerCase());
    if (at >= 0) col.set(c, at);
  }
  const missing = ["entry", "type", "tmdbId"].filter((c) => !col.has(c));
  if (missing.length) throw new ImportFileError(`CSV header is missing column(s): ${missing.join(", ")}`);
  if (records.length - 1 > MAX_ENTRIES) {
    throw new ImportFileError(`Too many rows (maximum ${MAX_ENTRIES})`);
  }

  return records.slice(1).map((rec, i) => {
    const get = (c: string) => {
      const at = col.get(c);
      const v = at === undefined ? undefined : rec.cells[at];
      return v === undefined ? "" : unguard(v);
    };
    const entryRaw = get("entry").trim().toLowerCase();
    const entry = entryRaw === "source" || entryRaw === "subtitle" ? entryRaw : null;
    const fields: Record<string, unknown> = {};
    for (const c of entry === "subtitle" ? SUBTITLE_COLUMNS : SOURCE_COLUMNS) fields[c] = csvValue(c, get(c));
    return {
      index: i + 1,
      line: rec.line,
      entry,
      type: get("type").trim().toLowerCase(),
      tmdbId: numeric(get("tmdbId")),
      season: numeric(get("season")),
      episode: numeric(get("episode")),
      title: get("title"),
      fields,
      parseError: entry ? undefined : 'Column "entry" must be "source" or "subtitle"',
    };
  });
}

const numeric = (v: string): unknown => {
  const s = v.trim();
  if (s === "") return null;
  return /^-?\d+$/.test(s) ? Number(s) : s;
};

/** CSV cells are strings; convert to the types the zod schemas expect. */
function csvValue(column: string, raw: string): unknown {
  if (column === "sortOrder") return numeric(raw);
  if (column === "isActive") {
    const s = raw.trim().toLowerCase();
    if (s === "") return undefined;
    if (["true", "1", "yes"].includes(s)) return true;
    if (["false", "0", "no"].includes(s)) return false;
    return raw;
  }
  if (column === "quality") return raw === "" ? null : raw;
  if (column === "kind" || column === "format") return raw.trim().toLowerCase();
  return raw;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function jsonToRaw(text: string): RawEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new ImportFileError("File is not valid JSON");
  }
  if (!Array.isArray(data)) throw new ImportFileError("JSON must be an array of items");

  const out: RawEntry[] = [];
  const add = (e: Omit<RawEntry, "index" | "line">) => {
    if (out.length >= MAX_ENTRIES) throw new ImportFileError(`Too many entries (maximum ${MAX_ENTRIES})`);
    out.push({ index: out.length + 1, line: null, ...e });
  };
  data.forEach((it, n) => {
    if (!isObj(it)) {
      return add({ ...NO_ID, entry: null, parseError: `Item ${n + 1} is not an object` });
    }
    const id = { type: it.type, tmdbId: it.tmdbId, season: it.season, episode: it.episode, title: it.title };
    for (const [key, entry] of [
      ["sources", "source"],
      ["subtitles", "subtitle"],
    ] as const) {
      const list = it[key];
      if (list === undefined || list === null) continue;
      if (!Array.isArray(list)) {
        add({ ...id, entry, fields: {}, parseError: `Item ${n + 1}: "${key}" must be an array` });
        continue;
      }
      for (const f of list) {
        if (isObj(f)) add({ ...id, entry, fields: f });
        else add({ ...id, entry, fields: {}, parseError: `Item ${n + 1}: each ${entry} must be an object` });
      }
    }
  });
  return out;
}
const NO_ID = { type: null, tmdbId: null, season: null, episode: null, title: null, fields: {} };

// ------------------------------------------------------------------ planning

export type RowStatus = "new" | "duplicate" | "error";
export type PlanRow = {
  index: number;
  line: number | null;
  entry: EntryKind | null;
  type: ItemType | null;
  tmdbId: number | null;
  season: number | null;
  episode: number | null;
  title: string;
  url: string;
  status: RowStatus;
  message: string;
};
export type PlanSummary = {
  total: number;
  new: number;
  duplicates: number;
  errors: number;
  sourcesNew: number;
  subtitlesNew: number;
};
type NewSource = typeof sources.$inferInsert;
type NewSubtitle = typeof subtitles.$inferInsert;
export type Plan = {
  summary: PlanSummary;
  rows: PlanRow[];
  toInsert: { sources: NewSource[]; subtitles: NewSubtitle[] };
};

// Placeholder parent so the real create schemas (URL, https-embed, enums, lengths) validate the fields.
const PLACEHOLDER_PARENT = "00000000-0000-4000-8000-000000000000";

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues
    .map((i) => {
      const p = i.path.filter((k) => k !== "movieId").join(".");
      return p ? `${p}: ${i.message}` : i.message;
    })
    .join("; ");

type Identity = { type: ItemType; tmdbId: number; season: number | null; episode: number | null };
type Valid = { label: string; url: string; sortOrder: number | undefined; data: Record<string, unknown> };

function readIdentity(r: RawEntry): Identity | string {
  if (r.type !== "movie" && r.type !== "episode") return 'type must be "movie" or "episode"';
  const posInt = (v: unknown) => typeof v === "number" && Number.isInteger(v);
  if (!posInt(r.tmdbId) || (r.tmdbId as number) <= 0) return "tmdbId must be a positive integer";
  if (r.type === "movie") return { type: "movie", tmdbId: r.tmdbId as number, season: null, episode: null };
  for (const [name, v] of [
    ["season", r.season],
    ["episode", r.episode],
  ] as const) {
    if (!posInt(v) || (v as number) < 0) return `${name} must be a non-negative integer for episodes`;
  }
  return { type: "episode", tmdbId: r.tmdbId as number, season: r.season as number, episode: r.episode as number };
}

function validateFields(r: RawEntry): Valid | string {
  const f = r.fields;
  const order = blank(f.sortOrder) ? undefined : f.sortOrder;
  const base = { movieId: PLACEHOLDER_PARENT, sortOrder: order ?? 0 };
  if (r.entry === "subtitle") {
    const res = subtitleCreate.safeParse({
      ...base,
      label: f.label,
      language: f.language,
      url: f.url,
      format: f.format,
    });
    if (!res.success) return issues(res.error);
    const data = withoutParent(res.data);
    return { label: data.label, url: data.url, sortOrder: order === undefined ? undefined : data.sortOrder, data };
  }
  const res = sourceCreate.safeParse({
    ...base,
    label: f.label,
    kind: f.kind,
    url: f.url,
    quality: f.quality ?? null,
    isActive: blank(f.isActive) ? undefined : f.isActive,
  });
  if (!res.success) return issues(res.error);
  const data = withoutParent(res.data);
  return { label: data.label, url: data.url, sortOrder: order === undefined ? undefined : data.sortOrder, data };
}

function withoutParent<T extends { movieId?: string; episodeId?: string }>(v: T): Omit<T, "movieId" | "episodeId"> {
  const copy = { ...v };
  delete copy.movieId;
  delete copy.episodeId;
  return copy;
}

type Resolved = { id: string; title: string };

/** Library lookup for all identities at once: movies, shows, then seasons and episodes. */
async function resolveItems(ids: Identity[]) {
  const movieTmdb = [...new Set(ids.filter((i) => i.type === "movie").map((i) => i.tmdbId))];
  const showTmdb = [...new Set(ids.filter((i) => i.type === "episode").map((i) => i.tmdbId))];
  const found = new Map<string, Resolved>(); // item key -> episode/movie row
  const missing = new Map<string, string>(); // item key -> reason

  const [movieRows, showRows] = await Promise.all([
    movieTmdb.length
      ? db.select({ id: movies.id, tmdbId: movies.tmdbId, title: movies.title }).from(movies).where(inArray(movies.tmdbId, movieTmdb))
      : [],
    showTmdb.length
      ? db.select({ id: shows.id, tmdbId: shows.tmdbId, title: shows.name }).from(shows).where(inArray(shows.tmdbId, showTmdb))
      : [],
  ]);
  const movieBy = new Map(movieRows.map((m) => [m.tmdbId, m]));
  const showBy = new Map(showRows.map((s) => [s.tmdbId, s]));

  const showIds = showRows.map((s) => s.id);
  const seasonRows = showIds.length
    ? await db
        .select({ id: seasons.id, showId: seasons.showId, n: seasons.seasonNumber })
        .from(seasons)
        .where(inArray(seasons.showId, showIds))
    : [];
  const seasonBy = new Map(seasonRows.map((s) => [`${s.showId}:${s.n}`, s.id]));

  const epNumbers = [...new Set(ids.filter((i) => i.type === "episode").map((i) => i.episode!))];
  const episodeRows =
    seasonRows.length && epNumbers.length
      ? await db
          .select({ id: episodes.id, seasonId: episodes.seasonId, n: episodes.episodeNumber })
          .from(episodes)
          .where(
            and(
              inArray(episodes.seasonId, seasonRows.map((s) => s.id)),
              inArray(episodes.episodeNumber, epNumbers),
            ),
          )
      : [];
  const episodeBy = new Map(episodeRows.map((e) => [`${e.seasonId}:${e.n}`, e.id]));

  for (const i of ids) {
    const key = itemKey(i);
    if (found.has(key) || missing.has(key)) continue;
    if (i.type === "movie") {
      const m = movieBy.get(i.tmdbId);
      if (m) found.set(key, { id: m.id, title: m.title });
      else missing.set(key, `Item not found: no movie with TMDB id ${i.tmdbId} in the library`);
      continue;
    }
    const show = showBy.get(i.tmdbId);
    if (!show) {
      missing.set(key, `Item not found: no show with TMDB id ${i.tmdbId} in the library`);
      continue;
    }
    const seasonId = seasonBy.get(`${show.id}:${i.season}`);
    if (!seasonId) {
      missing.set(key, `Item not found: "${show.title}" has no season ${i.season}`);
      continue;
    }
    const episodeId = episodeBy.get(`${seasonId}:${i.episode}`);
    if (!episodeId) {
      missing.set(key, `Item not found: "${show.title}" season ${i.season} has no episode ${i.episode}`);
      continue;
    }
    found.set(key, { id: episodeId, title: show.title });
  }
  return { found, missing };
}

const itemKey = (i: Identity) => `${i.type}:${i.tmdbId}:${i.season}:${i.episode}`;

/** What each resolved item already has: URLs (for duplicate checks) and the last sort order. */
async function loadExisting(found: Map<string, Resolved>, ids: Identity[]) {
  const movieIds: string[] = [];
  const episodeIds: string[] = [];
  const seen = new Set<string>();
  for (const i of ids) {
    const key = itemKey(i);
    const r = found.get(key);
    if (!r || seen.has(key)) continue;
    seen.add(key);
    (i.type === "movie" ? movieIds : episodeIds).push(r.id);
  }
  const existing = { source: new Map<string, { urls: Set<string>; top: number }>(), subtitle: new Map<string, { urls: Set<string>; top: number }>() };
  const take = (kind: EntryKind, parent: string | null, url: string, order: number) => {
    if (!parent) return;
    const m = existing[kind];
    const e = m.get(parent) ?? { urls: new Set<string>(), top: -1 };
    e.urls.add(url);
    e.top = Math.max(e.top, order);
    m.set(parent, e);
  };
  const [ms, es, mt, et] = await Promise.all([
    movieIds.length
      ? db.select({ p: sources.movieId, url: sources.url, o: sources.sortOrder }).from(sources).where(and(isNotNull(sources.movieId), inArray(sources.movieId, movieIds)))
      : [],
    episodeIds.length
      ? db.select({ p: sources.episodeId, url: sources.url, o: sources.sortOrder }).from(sources).where(and(isNotNull(sources.episodeId), inArray(sources.episodeId, episodeIds)))
      : [],
    movieIds.length
      ? db.select({ p: subtitles.movieId, url: subtitles.url, o: subtitles.sortOrder }).from(subtitles).where(and(isNotNull(subtitles.movieId), inArray(subtitles.movieId, movieIds)))
      : [],
    episodeIds.length
      ? db.select({ p: subtitles.episodeId, url: subtitles.url, o: subtitles.sortOrder }).from(subtitles).where(and(isNotNull(subtitles.episodeId), inArray(subtitles.episodeId, episodeIds)))
      : [],
  ]);
  for (const r of [...ms, ...es]) take("source", r.p, r.url, r.o);
  for (const r of [...mt, ...et]) take("subtitle", r.p, r.url, r.o);
  return existing;
}

/** Parse, validate and plan a file. Read-only: shared by preview and commit. */
export async function planImport(format: FileFormat, text: string): Promise<Plan> {
  const raw = format === "csv" ? csvToRaw(text) : jsonToRaw(text);

  // 1. Per-entry validation without touching the database.
  type Checked = { r: RawEntry; id?: Identity; v?: Valid; error?: string };
  const checked: Checked[] = raw.map((r) => {
    if (r.parseError) return { r, error: r.parseError };
    const id = readIdentity(r);
    if (typeof id === "string") return { r, error: id };
    const v = validateFields(r);
    if (typeof v === "string") return { r, id, error: v };
    return { r, id, v };
  });

  // 2. Batched library lookups.
  const ids = checked.filter((c) => !c.error).map((c) => c.id!);
  const { found, missing } = await resolveItems(ids);
  const existing = await loadExisting(found, ids);

  // 3. Decide per entry, in file order.
  const rows: PlanRow[] = [];
  const toInsert: Plan["toInsert"] = { sources: [], subtitles: [] };
  const seenInFile = new Map<string, number>(); // item+kind+url -> first index
  const nextOrder = new Map<string, number>();

  for (const { r, id, v, error } of checked) {
    const row: PlanRow = {
      index: r.index,
      line: r.line,
      entry: r.entry,
      type: id?.type ?? null,
      tmdbId: id?.tmdbId ?? null,
      season: id?.season ?? null,
      episode: id?.episode ?? null,
      title: typeof r.title === "string" ? r.title : "",
      url: typeof r.fields.url === "string" ? r.fields.url.trim() : "",
      status: "error",
      message: "",
    };
    rows.push(row);
    if (error) {
      row.message = error;
      continue;
    }
    const key = itemKey(id!);
    const item = found.get(key);
    if (!item) {
      row.message = missing.get(key) ?? "Item not found";
      continue;
    }
    row.title = item.title;
    row.url = v!.url;
    const kind = r.entry!;
    const dupKey = `${kind}|${key}|${v!.url}`;
    const first = seenInFile.get(dupKey);
    if (first !== undefined) {
      row.status = "duplicate";
      row.message = `Same URL already appears in this file (row ${first})`;
      continue;
    }
    seenInFile.set(dupKey, r.index);
    const have = existing[kind].get(item.id);
    if (have?.urls.has(v!.url)) {
      row.status = "duplicate";
      row.message = "Already exists on this item";
      continue;
    }

    let sortOrder = v!.sortOrder;
    if (sortOrder === undefined) {
      const orderKey = `${kind}|${item.id}`;
      sortOrder = nextOrder.get(orderKey) ?? (have ? have.top + 1 : 0);
      nextOrder.set(orderKey, sortOrder + 1);
    }
    const parent = id!.type === "movie" ? { movieId: item.id } : { episodeId: item.id };
    if (kind === "source") {
      toInsert.sources.push({ ...parent, ...(v!.data as Omit<NewSource, "movieId" | "episodeId">), sortOrder });
    } else {
      toInsert.subtitles.push({ ...parent, ...(v!.data as Omit<NewSubtitle, "movieId" | "episodeId">), sortOrder });
    }
    row.status = "new";
    row.message = "Will be imported";
  }

  const count = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  return {
    rows,
    toInsert,
    summary: {
      total: rows.length,
      new: count("new"),
      duplicates: count("duplicate"),
      errors: count("error"),
      sourcesNew: toInsert.sources.length,
      subtitlesNew: toInsert.subtitles.length,
    },
  };
}

/** Inserts the planned rows in one atomic batch (neon-http has no interactive transactions). */
export async function commitPlan(plan: Plan) {
  const statements = [];
  for (let i = 0; i < plan.toInsert.sources.length; i += INSERT_CHUNK) {
    statements.push(db.insert(sources).values(plan.toInsert.sources.slice(i, i + INSERT_CHUNK)));
  }
  for (let i = 0; i < plan.toInsert.subtitles.length; i += INSERT_CHUNK) {
    statements.push(db.insert(subtitles).values(plan.toInsert.subtitles.slice(i, i + INSERT_CHUNK)));
  }
  if (statements.length === 0) return;
  await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
}

// ------------------------------------------------------------------ request handling

/** Reads the multipart `file` field and plans it; returns the plan or an error response. */
export async function planFromRequest(req: NextRequest): Promise<{ plan: Plan } | { error: NextResponse }> {
  const declared = Number(req.headers.get("content-length"));
  // Multipart framing adds a little on top of the file itself.
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + 64 * 1024) return { error: tooLarge() };

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { error: fail(400, "INVALID_BODY", "Request must be multipart/form-data with a file field") };
  }
  const file = form.get("file");
  if (!(file instanceof File)) return { error: fail(400, "INVALID_BODY", 'Missing "file" field') };
  if (file.size > MAX_FILE_BYTES) return { error: tooLarge() };

  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  const format: FileFormat | null = name.endsWith(".csv")
    ? "csv"
    : name.endsWith(".json")
      ? "json"
      : !name.includes(".") && type.includes("csv")
        ? "csv"
        : !name.includes(".") && type.includes("json")
          ? "json"
          : null;
  if (!format) return { error: fail(400, "UNSUPPORTED_FILE", "Only .csv and .json files are supported") };

  try {
    return { plan: await planImport(format, await file.text()) };
  } catch (e) {
    if (e instanceof ImportFileError) return { error: fail(e.status, "INVALID_FILE", e.message) };
    throw e;
  }
}

const tooLarge = () =>
  fail(413, "FILE_TOO_LARGE", `File is too large (maximum ${MAX_FILE_BYTES / 1024 / 1024} MB)`);
