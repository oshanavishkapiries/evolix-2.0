import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle>, userId: "" }));
vi.mock("@/db", () => ({ db: new Proxy({}, { get: (_, key) => { const value = Reflect.get(state.db, key); return typeof value === "function" ? value.bind(state.db) : value; } }) }));
vi.mock("@/lib/auth/session", () => ({ authenticate: vi.fn(async () => ({ userId: state.userId })) }));
import { POST } from "@/app/api/me/progress/route";
import { authenticate } from "@/lib/auth/session";
let pg: PGlite;
let tmdbId = 0;
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir("drizzle")).filter(f => f.endsWith(".sql")).sort()) await pg.exec(await readFile(`drizzle/${file}`, "utf8"));
  state.db = drizzle(pg);
  state.userId = randomUUID();
  await state.db.insert(schema.users).values({ id: state.userId, email: "progress-save@test.invalid", passwordHash: "unused" });
}, 30000);
afterAll(async () => { await pg?.close(); });
const save = (kind: "movie" | "episode", id: string, position = 50, duration = 100) => POST(new NextRequest("http://app.test/api/me/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, position, duration }) }));
it("inserts and updates published progress in one statement and returns completion", async () => {
  const [movie] = await state.db.insert(schema.movies).values({ tmdbId: ++tmdbId, title: "Published", isPublished: true }).returning();
  const execute = vi.spyOn(state.db, "execute");
  try {
    const first = await save("movie", movie.id);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, completed: false });
    expect(execute).toHaveBeenCalledTimes(1);
    const second = await save("movie", movie.id, 100);
    expect(await second.json()).toEqual({ ok: true, completed: true });
    expect(execute).toHaveBeenCalledTimes(2);
    const rows = await state.db.select().from(schema.watchProgress);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ positionSeconds: 100, durationSeconds: 100, completed: true });
  } finally { execute.mockRestore(); }
});
it("returns 404 for unpublished or missing movies", async () => {
  const [movie] = await state.db.insert(schema.movies).values({ tmdbId: ++tmdbId, title: "Private" }).returning();
  for (const id of [movie.id, randomUUID()]) {
    const result = await save("movie", id);
    expect(result.status).toBe(404);
    expect(await result.json()).toMatchObject({ code: "NOT_FOUND" });
  }
});
it.each([[true, true, true], [false, true, true], [true, false, true], [true, true, false]])("checks episode visibility (show %s, season %s, episode %s)", async (published, seasonVisible, episodeVisible) => {
  const [show] = await state.db.insert(schema.shows).values({ tmdbId: ++tmdbId, name: "Show", isPublished: published }).returning();
  const [season] = await state.db.insert(schema.seasons).values({ showId: show.id, seasonNumber: 1, isVisible: seasonVisible }).returning();
  const [episode] = await state.db.insert(schema.episodes).values({ seasonId: season.id, episodeNumber: 1, isVisible: episodeVisible }).returning();
  expect((await save("episode", episode.id)).status).toBe(published && seasonVisible && episodeVisible ? 200 : 404);
});
it("preserves authentication rejection", async () => {
  vi.mocked(authenticate).mockResolvedValueOnce(null);
  expect((await save("movie", randomUUID())).status).toBe(401);
});
