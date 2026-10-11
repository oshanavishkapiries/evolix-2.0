import { asc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { episodes, movies, seasons, shows, sources, subtitles } from "@/db/schema";
import { fail } from "@/lib/auth/http";
import { sourceCreate, subtitleCreate } from "@/lib/cms/schemas";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ENTRIES = 5000;
export const MAX_PREVIEW_ROWS = 1000;
const INSERT_CHUNK = 500;

export type ItemType = "movie" | "show";
export type EntryKind = "source" | "subtitle";
export type FileFormat = "csv" | "json";
/** The movie or show a file is exported from / imported into. */
export type Target = { type: ItemType; id: string };

const SOURCE_COLUMNS = ["label", "kind", "url", "quality", "audioLanguage", "sortOrder", "isActive"] as const;
const SUBTITLE_COLUMNS = ["label", "language", "url", "format", "sortOrder"] as const;
/**
 * One flat shape for movies and shows. Movies leave the structure columns empty. The structure columns
 * (names, isVisible) are read-only context: the importer ignores them.
 */
export const CSV_COLUMNS = [
  "entry",
  "seasonNumber",
  "seasonName",
  "episodeNumber",
  "episodeName",
  "isVisible",
  "label",
  "kind",
  "url",
  "quality",
  "audioLanguage",
  "sortOrder",
  "isActive",
  "language",
  "format",
] as const;

// ------------------------------------------------------------------ template

type SourceOut = {
  label: string;
  kind: string;
  url: string;
  quality: string | null;
  audioLanguage: string;
  sortOrder: number | null;
  isActive: boolean;
};
type SubtitleOut = { label: string; language: string; url: string; format: string; sortOrder: number | null };
type Entries = { sources: SourceOut[]; subtitles: SubtitleOut[] };
export type EpisodeTemplate = { episodeNumber: number; name: string; isVisible: boolean } & Entries;
export type SeasonTemplate = { seasonNumber: number; name: string; isVisible: boolean; episodes: EpisodeTemplate[] };
export type Template =
  | ({ type: "movie"; title: string; tmdbId: number } & Entries)
  | { type: "show"; title: string; tmdbId: number; seasons: SeasonTemplate[] };

/** Empty rows the admin fills in; ignored by the importer while the URL stays blank. */
const blankSource = (): SourceOut => ({ label: "", kind: "direct", url: "", quality: null, audioLanguage: "", sortOrder: null, isActive: true });
const blankSubtitle = (): SubtitleOut => ({ label: "", language: "", url: "", format: "vtt", sortOrder: null });

/** Existing rows, or one blank placeholder of each entry type when there are none. */
function withPlaceholders(e: { sources: SourceOut[]; subtitles: SubtitleOut[] }): Entries {
  return {
    sources: e.sources.length ? e.sources : [blankSource()],
    subtitles: e.subtitles.length ? e.subtitles : [blankSubtitle()],
  };
}

const sourceOut = (r: typeof sources.$inferSelect): SourceOut => ({
  label: r.label,
  kind: r.kind,
  url: r.url,
  quality: r.quality,
  audioLanguage: r.audioLanguage,
  sortOrder: r.sortOrder,
  isActive: r.isActive,
});
const subtitleOut = (r: typeof subtitles.$inferSelect): SubtitleOut => ({
  label: r.label,
  language: r.language,
  url: r.url,
  format: r.format,
  sortOrder: r.sortOrder,
});

export async function loadMovieTemplate(id: string): Promise<Template | null> {
  const [movie] = await db
    .select({ title: movies.title, tmdbId: movies.tmdbId })
    .from(movies)
    .where(eq(movies.id, id));
  if (!movie) return null;
  const [src, subs] = await Promise.all([
    db.select().from(sources).where(eq(sources.movieId, id)).orderBy(asc(sources.sortOrder), asc(sources.createdAt), asc(sources.id)),
    db.select().from(subtitles).where(eq(subtitles.movieId, id)).orderBy(asc(subtitles.sortOrder), asc(subtitles.createdAt), asc(subtitles.id)),
  ]);
  return {
    type: "movie",
    ...movie,
    ...withPlaceholders({ sources: src.map(sourceOut), subtitles: subs.map(subtitleOut) }),
  };
}

/** Every season and episode of the show (hidden ones too) with its current sources and subtitles. */
export async function loadShowTemplate(id: string): Promise<Template | null> {
  const [show] = await db.select({ title: shows.name, tmdbId: shows.tmdbId }).from(shows).where(eq(shows.id, id));
  if (!show) return null;
  const [seasonRows, episodeRows, srcRows, subRows] = await Promise.all([
    db.select().from(seasons).where(eq(seasons.showId, id)).orderBy(asc(seasons.seasonNumber)),
    db
      .select({ e: episodes })
      .from(episodes)
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .where(eq(seasons.showId, id))
      .orderBy(asc(episodes.episodeNumber)),
    db
      .select({ s: sources })
      .from(sources)
      .innerJoin(episodes, eq(episodes.id, sources.episodeId))
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .where(eq(seasons.showId, id))
      .orderBy(asc(sources.sortOrder), asc(sources.createdAt), asc(sources.id)),
    db
      .select({ s: subtitles })
      .from(subtitles)
      .innerJoin(episodes, eq(episodes.id, subtitles.episodeId))
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .where(eq(seasons.showId, id))
      .orderBy(asc(subtitles.sortOrder), asc(subtitles.createdAt), asc(subtitles.id)),
  ]);

  const byEpisode = new Map<string, { sources: SourceOut[]; subtitles: SubtitleOut[] }>();
  const entriesOf = (episodeId: string | null) => {
    let e = byEpisode.get(episodeId ?? "");
    if (!e) byEpisode.set(episodeId ?? "", (e = { sources: [], subtitles: [] }));
    return e;
  };
  for (const { s } of srcRows) entriesOf(s.episodeId).sources.push(sourceOut(s));
  for (const { s } of subRows) entriesOf(s.episodeId).subtitles.push(subtitleOut(s));

  return {
    type: "show",
    ...show,
    seasons: seasonRows.map((s) => ({
      seasonNumber: s.seasonNumber,
      name: s.name,
      isVisible: s.isVisible,
      episodes: episodeRows
        .filter(({ e }) => e.seasonId === s.id)
        .map(({ e }) => ({
          episodeNumber: e.episodeNumber,
          name: e.name,
          isVisible: e.isVisible,
          ...withPlaceholders(byEpisode.get(e.id) ?? { sources: [], subtitles: [] }),
        })),
    })),
  };
}

/** `evolix-{slug}-providers.{ext}`, falling back to the TMDB id when the title has no usable characters. */
export function templateFilename(t: Template, format: FileFormat) {
  const slug = t.title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `evolix-${slug || t.tmdbId}-providers.${format}`;
}

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

export function buildJson(t: Template): string {
  return JSON.stringify(t, null, 2) + "\n";
}

export function buildCsv(t: Template): string {
  const lines = [CSV_COLUMNS.join(",")];
  const push = (cells: Record<string, unknown>) =>
    lines.push(CSV_COLUMNS.map((c) => csvCell(cells[c])).join(","));
  const rows = (ctx: Record<string, unknown>, e: Entries) => {
    for (const s of e.sources) push({ entry: "source", ...ctx, ...s });
    for (const s of e.subtitles) push({ entry: "subtitle", ...ctx, ...s });
  };
  if (t.type === "movie") rows({}, t);
  else {
    for (const s of t.seasons) {
      for (const e of s.episodes) {
        // One column for both levels: an episode in a hidden season is not visible either.
        const ctx = {
          seasonNumber: s.seasonNumber,
          seasonName: s.name,
          episodeNumber: e.episodeNumber,
          episodeName: e.name,
          isVisible: s.isVisible && e.isVisible,
        };
        rows(ctx, e);
      }
    }
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ------------------------------------------------------------------ parsing

/** One source/subtitle entry as read from the file, before validation. */
type RawEntry = {
  /** 1-based position among all entries in the file. */
  index: number;
  /** CSV only: line where the record starts. */
  line: number | null;
  entry: EntryKind | null;
  season: unknown;
  episode: unknown;
  fields: Record<string, unknown>;
  /** Untouched template placeholder: the URL is empty. */
  blank?: boolean;
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
const blankUrl = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

function csvToRaw(text: string, type: ItemType): RawEntry[] {
  const records = parseCsv(text);
  if (records.length === 0) throw new ImportFileError("CSV file is empty");
  const header = records[0].cells.map((h) => h.trim().toLowerCase());
  const col = new Map<string, number>();
  for (const c of CSV_COLUMNS) {
    const at = header.indexOf(c.toLowerCase());
    if (at >= 0) col.set(c, at);
  }
  const required = type === "show" ? ["entry", "url", "seasonNumber", "episodeNumber"] : ["entry", "url"];
  const missing = required.filter((c) => !col.has(c));
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
      season: numeric(get("seasonNumber")),
      episode: numeric(get("episodeNumber")),
      fields,
      blank: get("url").trim() === "",
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
  if (column === "kind" || column === "format" || column === "audioLanguage") return raw.trim().toLowerCase();
  return raw;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Accepts the shapes the templates produce: a movie object, or a show with seasons[].episodes[]. */
function jsonToRaw(text: string, type: ItemType): RawEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new ImportFileError("File is not valid JSON");
  }
  if (!isObj(data)) throw new ImportFileError("JSON must be an object like the exported template");
  if (data.type !== undefined && data.type !== type) {
    throw new ImportFileError(`This file is a ${String(data.type)} template; it cannot be imported into a ${type}`);
  }

  const out: RawEntry[] = [];
  const add = (e: Omit<RawEntry, "index" | "line">) => {
    if (out.length >= MAX_ENTRIES) throw new ImportFileError(`Too many entries (maximum ${MAX_ENTRIES})`);
    out.push({ index: out.length + 1, line: null, ...e });
  };
  const bad = (parseError: string, season: unknown = null, episode: unknown = null) =>
    add({ entry: null, season, episode, fields: {}, parseError });

  /** Reads the `sources` and `subtitles` arrays of a movie or episode object. */
  const entries = (holder: Record<string, unknown>, where: string, season: unknown, episode: unknown) => {
    for (const [key, entry] of [
      ["sources", "source"],
      ["subtitles", "subtitle"],
    ] as const) {
      const list = holder[key];
      if (list === undefined || list === null) continue;
      if (!Array.isArray(list)) {
        add({ entry, season, episode, fields: {}, parseError: `${where}: "${key}" must be an array` });
        continue;
      }
      for (const f of list) {
        if (isObj(f)) add({ entry, season, episode, fields: f, blank: blankUrl(f.url) });
        else add({ entry, season, episode, fields: {}, parseError: `${where}: each ${entry} must be an object` });
      }
    }
  };

  if (type === "movie") {
    entries(data, "Movie", null, null);
    return out;
  }
  if (!Array.isArray(data.seasons)) throw new ImportFileError('JSON must contain a "seasons" array');
  data.seasons.forEach((s, si) => {
    if (!isObj(s)) return bad(`Season entry ${si + 1} is not an object`);
    if (!Array.isArray(s.episodes)) return bad(`Season entry ${si + 1}: "episodes" must be an array`, s.seasonNumber);
    s.episodes.forEach((e, ei) => {
      if (!isObj(e)) return bad(`Season entry ${si + 1}, episode entry ${ei + 1} is not an object`, s.seasonNumber);
      entries(e, `Season ${String(s.seasonNumber)} episode ${String(e.episodeNumber)}`, s.seasonNumber, e.episodeNumber);
    });
  });
  return out;
}

// ------------------------------------------------------------------ planning

export type RowStatus = "new" | "duplicate" | "error";
export type PlanRow = {
  index: number;
  line: number | null;
  entry: EntryKind | null;
  season: number | null;
  episode: number | null;
  url: string;
  status: RowStatus;
  message: string;
};
export type PlanSummary = {
  total: number;
  new: number;
  duplicates: number;
  errors: number;
  /** Template placeholders with an empty URL; ignored. */
  blank: number;
  sourcesNew: number;
  subtitlesNew: number;
};
type NewSource = typeof sources.$inferInsert;
type NewSubtitle = typeof subtitles.$inferInsert;
export type Plan = {
  summary: PlanSummary;
  /** Blank placeholders are counted in the summary but not listed. */
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

type Valid = { label: string; url: string; sortOrder: number | undefined; data: Record<string, unknown> };

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
    audioLanguage: blank(f.audioLanguage) ? undefined : f.audioLanguage,
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

type Existing = Map<string, { urls: Set<string>; top: number }>;
/** Everything about the target item the planner needs; all reads happen here. */
type Context = {
  type: ItemType;
  /** Movie: the movie id under key "". Show: episode ids by `season:episode`. */
  parents: Map<string, string>;
  seasonNumbers: Set<number>;
  existing: { source: Existing; subtitle: Existing };
};

/** Loads the target's episodes and current providers; null when the movie/show does not exist. */
async function loadContext(target: Target): Promise<Context | null> {
  const parents = new Map<string, string>();
  const seasonNumbers = new Set<number>();
  const existing = { source: new Map() as Existing, subtitle: new Map() as Existing };
  const take = (kind: EntryKind, parent: string | null, url: string, order: number) => {
    if (!parent) return;
    const m = existing[kind];
    const e = m.get(parent) ?? { urls: new Set<string>(), top: -1 };
    e.urls.add(url);
    e.top = Math.max(e.top, order);
    m.set(parent, e);
  };

  if (target.type === "movie") {
    const [m] = await db.select({ id: movies.id }).from(movies).where(eq(movies.id, target.id));
    if (!m) return null;
    parents.set("", m.id);
    const [src, subs] = await Promise.all([
      db.select({ p: sources.movieId, url: sources.url, o: sources.sortOrder }).from(sources).where(eq(sources.movieId, m.id)),
      db.select({ p: subtitles.movieId, url: subtitles.url, o: subtitles.sortOrder }).from(subtitles).where(eq(subtitles.movieId, m.id)),
    ]);
    for (const r of src) take("source", r.p, r.url, r.o);
    for (const r of subs) take("subtitle", r.p, r.url, r.o);
    return { type: "movie", parents, seasonNumbers, existing };
  }

  const [show] = await db.select({ id: shows.id }).from(shows).where(eq(shows.id, target.id));
  if (!show) return null;
  const [seasonRows, episodeRows, src, subs] = await Promise.all([
    db.select({ n: seasons.seasonNumber }).from(seasons).where(eq(seasons.showId, show.id)),
    db
      .select({ id: episodes.id, s: seasons.seasonNumber, n: episodes.episodeNumber })
      .from(episodes)
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .where(eq(seasons.showId, show.id)),
    db
      .select({ p: sources.episodeId, url: sources.url, o: sources.sortOrder })
      .from(sources)
      .innerJoin(episodes, eq(episodes.id, sources.episodeId))
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .where(eq(seasons.showId, show.id)),
    db
      .select({ p: subtitles.episodeId, url: subtitles.url, o: subtitles.sortOrder })
      .from(subtitles)
      .innerJoin(episodes, eq(episodes.id, subtitles.episodeId))
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .where(eq(seasons.showId, show.id)),
  ]);
  for (const s of seasonRows) seasonNumbers.add(s.n);
  for (const e of episodeRows) parents.set(`${e.s}:${e.n}`, e.id);
  for (const r of src) take("source", r.p, r.url, r.o);
  for (const r of subs) take("subtitle", r.p, r.url, r.o);
  return { type: "show", parents, seasonNumbers, existing };
}

/** Season/episode numbers of a row, or the error to report. */
function locate(ctx: Context, r: RawEntry): { key: string; season: number | null; episode: number | null } | string {
  if (ctx.type === "movie") {
    if (!blank(r.season) || !blank(r.episode)) return "A movie has no seasons or episodes; leave these empty";
    return { key: "", season: null, episode: null };
  }
  const int = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
  if (!int(r.season) || !int(r.episode)) return "seasonNumber and episodeNumber must be non-negative integers";
  const [season, episode] = [r.season as number, r.episode as number];
  if (!ctx.seasonNumbers.has(season)) return `Season ${season} does not exist in this show`;
  if (!ctx.parents.has(`${season}:${episode}`)) return `Season ${season} has no episode ${episode}`;
  return { key: `${season}:${episode}`, season, episode };
}

/** Parse, validate and plan a file against the target. Read-only: shared by preview and commit. */
function planImport(ctx: Context, format: FileFormat, text: string): Plan {
  const raw = format === "csv" ? csvToRaw(text, ctx.type) : jsonToRaw(text, ctx.type);

  const rows: PlanRow[] = [];
  const toInsert: Plan["toInsert"] = { sources: [], subtitles: [] };
  const seenInFile = new Map<string, number>(); // kind+parent+url -> first index
  const nextOrder = new Map<string, number>();
  let blanks = 0;

  for (const r of raw) {
    if (r.blank) {
      blanks++;
      continue;
    }
    const row: PlanRow = {
      index: r.index,
      line: r.line,
      entry: r.entry,
      season: typeof r.season === "number" ? r.season : null,
      episode: typeof r.episode === "number" ? r.episode : null,
      url: typeof r.fields.url === "string" ? r.fields.url.trim() : "",
      status: "error",
      message: "",
    };
    rows.push(row);
    if (r.parseError) {
      row.message = r.parseError;
      continue;
    }
    const at = locate(ctx, r);
    if (typeof at === "string") {
      row.message = at;
      continue;
    }
    const v = validateFields(r);
    if (typeof v === "string") {
      row.message = v;
      continue;
    }
    row.url = v.url;
    const kind = r.entry!;
    const parent = ctx.parents.get(at.key)!;
    const dupKey = `${kind}|${parent}|${v.url}`;
    const first = seenInFile.get(dupKey);
    if (first !== undefined) {
      row.status = "duplicate";
      row.message = `Same URL already appears in this file (row ${first})`;
      continue;
    }
    seenInFile.set(dupKey, r.index);
    const have = ctx.existing[kind].get(parent);
    if (have?.urls.has(v.url)) {
      row.status = "duplicate";
      row.message = "Already exists";
      continue;
    }

    let sortOrder = v.sortOrder;
    if (sortOrder === undefined) {
      const orderKey = `${kind}|${parent}`;
      sortOrder = nextOrder.get(orderKey) ?? (have ? have.top + 1 : 0);
      nextOrder.set(orderKey, sortOrder + 1);
    }
    const owner = ctx.type === "movie" ? { movieId: parent } : { episodeId: parent };
    if (kind === "source") {
      toInsert.sources.push({ ...owner, ...(v.data as Omit<NewSource, "movieId" | "episodeId">), sortOrder });
    } else {
      toInsert.subtitles.push({ ...owner, ...(v.data as Omit<NewSubtitle, "movieId" | "episodeId">), sortOrder });
    }
    row.status = "new";
    row.message = "Will be imported";
  }

  const count = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  return {
    rows,
    toInsert,
    summary: {
      total: raw.length,
      new: count("new"),
      duplicates: count("duplicate"),
      errors: count("error"),
      blank: blanks,
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

/** Template download response. */
export function templateResponse(t: Template, format: FileFormat) {
  return new NextResponse(format === "csv" ? buildCsv(t) : buildJson(t), {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${templateFilename(t, format)}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Reads the multipart `file` field and plans it for the target; returns the plan or an error response. */
export async function planFromRequest(
  req: NextRequest,
  target: Target,
  notFound: () => NextResponse,
): Promise<{ plan: Plan } | { error: NextResponse }> {
  const ctx = await loadContext(target);
  if (!ctx) return { error: notFound() };

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
    return { plan: planImport(ctx, format, await file.text()) };
  } catch (e) {
    if (e instanceof ImportFileError) return { error: fail(e.status, "INVALID_FILE", e.message) };
    throw e;
  }
}

const tooLarge = () =>
  fail(413, "FILE_TOO_LARGE", `File is too large (maximum ${MAX_FILE_BYTES / 1024 / 1024} MB)`);
