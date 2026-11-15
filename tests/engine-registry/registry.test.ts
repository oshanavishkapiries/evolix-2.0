import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("@/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite();
  return { db: drizzle(client), testClient: client };
});
vi.mock("@/lib/config", () => ({ getConfig: vi.fn(async () => ({ EVO_ENGINES: '["http://env.test:8000"]', EVO_SECRET_TOKEN: "global-fixture-token" })) }));
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: vi.fn(async () => ({ id: "admin-fixture", email: "registry-admin@example.test" })) }));
vi.mock("@/lib/evo/overview", () => ({ enginesOverview: vi.fn(async () => []) }));
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { GET, POST } from "@/app/api/admin/evo/engines/route";
import { PATCH, DELETE } from "@/app/api/admin/evo/engines/[id]/route";
import { POST as ROTATE } from "@/app/api/admin/evo/engines/[id]/rotate-token/route";
import { getConfig } from "@/lib/config";
import * as database from "@/db";
import type { PGlite } from "@electric-sql/pglite";
import { addEngine, registeredEngines, listEngines, updateEngine, rotateEngineToken, removeEngine, validateEngineUrl, engineToken, generateToken, testEngineConnection, invalidateEngineCache } from "@/lib/evo/registry";
import { engineFetch, engineIdFor } from "@/lib/evo/client";
import { ensureRows, engineForTask, claimEngine } from "@/lib/evo/scheduler";
import { isEngineCall } from "@/lib/evo/engine";
const client = (database as unknown as { testClient: PGlite }).testClient;
const actor = "registry-admin@example.test";
const fetchMock = vi.fn();
beforeAll(async () => {
  await client.exec(`create table evo_engines (id text primary key, url text not null, draining boolean not null default false, healthy boolean not null default true,
    last_checked_at timestamptz, last_ok_at timestamptz, last_error text, active_jobs integer not null default 0, queue_depth integer not null default 0,
    max_extractions integer not null default 1, free_disk_gb real, updated_at timestamptz not null default now());
    create table evo_tasks (task_id text primary key, engine_id text not null, kind text not null, claim_key text, created_at timestamptz not null default now());`);
  for (const file of ["0021_silky_victor_mancha.sql", "0022_orange_the_liberteens.sql", "0023_slim_gauntlet.sql"]) await client.exec(readFileSync(`drizzle/${file}`, "utf8"));
});
beforeEach(async () => {
  invalidateEngineCache();
  await client.exec("truncate evo_engines, evo_tasks, config_audit");
  vi.stubEnv("CONFIG_ENCRYPTION_KEY", "ab".repeat(32));
  fetchMock.mockReset().mockImplementation(async () => Response.json({ waiting_extraction: 0, extracting: 0, caching: 0, status: "COMPLETED", version: "fixture-v1" }));
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(requireAdmin).mockResolvedValue({ id: "admin-fixture", email: actor });
});
afterAll(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await client.close(); });
describe("engine DB registry", () => {
  it("uses env with no managed rows, then replaces the entire list with managed records", async () => {
    expect((await registeredEngines()).map((e) => e.url)).toEqual(["http://env.test:8000"]);
    await ensureRows();
    const created = await addEngine({ name: "Managed", url: "http://lan.test:8000" }, actor);
    expect((await registeredEngines()).map((e) => e.id)).toEqual([created.engine.id]);
    expect((await listEngines()).managed).toBe(true);
    const row = (await client.query<{ config_version: number; config_pushed_version: number }>("select * from evo_engines where managed")).rows[0];
    expect(row).toMatchObject({ config_version: 0, config_pushed_version: 0 });
    await client.exec("update evo_engines set config_version = 3, config_pushed_version = 2 where managed");
    await ensureRows();
    expect((await listEngines()).engines[0]).toMatchObject({ configVersion: 3, configPushedVersion: 2 });
  });
  it("encrypts at rest, reveals only on create/rotation, and masks every audit/list value", async () => {
    const added = await addEngine({ name: "Private", url: "http://private.test:8000" }, actor);
    expect(added.token).toMatch(/^[a-f0-9]{48}$/);
    expect(added.envLine).toBe(`EVO_SECRET_TOKEN=${added.token}`);
    const stored = (await client.query<{ token: string }>("select token from evo_engines")).rows[0].token;
    expect(stored).toMatch(/^enc:v1:/); expect(stored).not.toContain(added.token);
    expect(JSON.stringify(await listEngines())).not.toContain(added.token);
    expect((await listEngines()).engines[0].tokenMask).toBe(`••••${added.token.slice(-4)}`);
    await updateEngine(added.engine.id, { name: "Renamed" }, actor);
    const rotated = await rotateEngineToken(added.engine.id, actor);
    expect(rotated.token).not.toBe(added.token); expect(await engineToken(added.engine.id)).toBe(rotated.token);
    await removeEngine(added.engine.id, actor, true);
    const audit = await client.query<{ scope: string; actor: string; key: string }>("select * from config_audit order by at");
    expect(audit.rows.map((r) => r.key)).toEqual(["engine.add", "engine.update", "engine.rotate-token", "engine.remove"]);
    expect(audit.rows.every((r) => r.scope === `engine:${added.engine.id}` && r.actor === actor)).toBe(true);
    expect(JSON.stringify(audit.rows)).not.toContain(added.token); expect(JSON.stringify(audit.rows)).not.toContain(rotated.token);
    expect(JSON.stringify(audit.rows)).toContain(`••••${rotated.token.slice(-4)}`);
  });
  it("selects per-engine tokens over the global fallback in transport and callbacks", async () => {
    await ensureRows();
    const envRef = (await registeredEngines())[0];
    await engineFetch("/queue", { engine: envRef });
    expect(fetchMock.mock.calls[0][1].headers["X-Evo-Secret"]).toBe("global-fixture-token");
    const added = await addEngine({ name: "Token", url: "http://token.test:8000", token: "per-engine-fixture-token" }, actor);
    await engineFetch("/queue", { engine: added.engine, headers: { "X-Evo-Secret": "wrong", "x-evo-secret": "also-wrong" } });
    expect(fetchMock.mock.lastCall?.[1].headers["X-Evo-Secret"]).toBe(added.token);
    expect(fetchMock.mock.lastCall?.[1].redirect).toBe("error");
    expect(await isEngineCall(new Request("http://app.test", { headers: { "x-evo-secret": added.token } }))).toBe(true);
    expect(await isEngineCall(new Request("http://app.test", { headers: { "x-evo-secret": "global-fixture-token" } }))).toBe(false);
    await client.exec("update evo_engines set token = null where managed");
    invalidateEngineCache();
    expect(await engineToken(added.engine.id)).toBe("global-fixture-token");
  });
  it("requires drain, no live jobs and no owned in-flight tasks; force preserves task history", async () => {
    const added = await addEngine({ name: "Busy", url: "http://busy.test:8000" }, actor), id = added.engine.id;
    await expect(removeEngine(id, actor)).rejects.toThrow(/Drain/);
    await client.query("update evo_engines set draining = true where id = $1", [id]);
    fetchMock.mockResolvedValueOnce(Response.json({ waiting_extraction: 0, extracting: 1, caching: 0 }));
    await expect(removeEngine(id, actor)).rejects.toThrow(/active/);
    await client.query("insert into evo_tasks (task_id, engine_id, kind) values ('owned-active', $1, 'ingest')", [id]);
    fetchMock.mockResolvedValueOnce(Response.json({ waiting_extraction: 0, extracting: 0, caching: 0 })).mockResolvedValueOnce(Response.json({ status: "STREAMING" }));
    await expect(removeEngine(id, actor)).rejects.toThrow(/in-flight/);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(removeEngine(id, actor)).rejects.toThrow(/unreachable/);
    await removeEngine(id, actor, true);
    expect((await client.query("select * from evo_tasks")).rows).toHaveLength(1);
    await expect(engineForTask("owned-active")).rejects.toThrow(/no longer configured/);
  });
  it("removes an empty drained engine without force and never resurrects it from env", async () => {
    await ensureRows(); const id = engineIdFor("http://env.test:8000");
    await client.exec("update evo_engines set draining = true");
    await removeEngine(id, actor);
    await ensureRows(); expect(await registeredEngines()).toEqual([]);
    expect((await client.query("select * from evo_engines where removed_at is not null")).rows).toHaveLength(1);
  });
  it("ensureRows never overwrites managed names, URLs, tokens or tombstones", async () => {
    const added = await addEngine({ name: "Stable", url: "http://stable.test:8000" }, actor);
    await updateEngine(added.engine.id, { url: "http://changed.test:8000" }, actor);
    await ensureRows();
    expect((await listEngines()).engines[0]).toMatchObject({ name: "Stable", url: "http://changed.test:8000" });
    expect(await engineToken(added.engine.id)).toBe(added.token);
  });
  it("honors draining even when only one engine exists", async () => {
    const added = await addEngine({ name: "Only engine", url: "http://single.test:8000" }, actor);
    expect(await claimEngine("fixture-job")).toMatchObject({ id: added.engine.id });
    await client.query("update evo_engines set draining = true where id = $1", [added.engine.id]);
    await expect(claimEngine("new-job")).rejects.toThrow(/draining/);
  });
  it("does not resurrect a row removed after the scheduler read its env snapshot", async () => {
    await ensureRows();
    vi.mocked(getConfig).mockImplementationOnce(async () => {
      await client.exec("update evo_engines set removed_at = now(), managed = false");
      return { EVO_ENGINES: '["http://env.test:8000"]', EVO_SECRET_TOKEN: "global-fixture-token" } as Awaited<ReturnType<typeof getConfig>>;
    });
    await ensureRows();
    expect((await client.query("select * from evo_engines where removed_at is not null")).rows).toHaveLength(1);
    expect(await registeredEngines()).toEqual([]);
  });
  it("rejects duplicate addresses and invalid/metadata URLs while permitting LAN/localhost", async () => {
    await addEngine({ name: "First", url: "http://duplicate.test:8000/" }, actor);
    await expect(addEngine({ name: "Again", url: "http://duplicate.test:8000" }, actor)).rejects.toThrow(/exists/);
    const second = await addEngine({ name: "Second", url: "http://other.test:8000" }, actor);
    await expect(updateEngine(second.engine.id, { url: "http://duplicate.test:8000" }, actor)).rejects.toThrow(/exists/);
    for (const url of ["file:///etc/passwd", "http://169.254.169.254", "http://0xa9fea9fe", "http://[::ffff:169.254.169.254]", "http://[fe80::1]", "http://metadata.google.internal", "http://user:secret@host.test", "http://host.test?q=x"]) expect(() => validateEngineUrl(url)).toThrow();
    for (const url of ["http://localhost:8000", "http://10.0.0.2:8000", "https://192.168.1.2", "http://[::1]:8000"]) expect(validateEngineUrl(url)).toBeTruthy();
    expect(generateToken()).toHaveLength(48);
  });
  it("tests an unsaved candidate on a protected endpoint and does not persist it", async () => {
    expect(await testEngineConnection({ url: "http://candidate.test:8000", token: "candidate-fixture-token" })).toMatchObject({ reachable: true, authOk: true, version: "fixture-v1" });
    expect(fetchMock.mock.lastCall?.[0]).toBe("http://candidate.test:8000/api/v1/media/queue");
    expect(fetchMock.mock.lastCall?.[1].headers["X-Evo-Secret"]).toBe("candidate-fixture-token");
    expect((await client.query("select * from evo_engines")).rows).toEqual([]);
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    expect(await testEngineConnection({ url: "http://candidate.test:8000", token: "candidate-fixture-token" })).toMatchObject({ reachable: true, authOk: false });
  });
});

const request = (path: string, method = "GET", body?: unknown) => new NextRequest(`http://app.test/api/admin/evo/engines${path}`, {
  method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});
describe("admin registry API", () => {
  it("returns tokens once on create/rotate and never in GET, including encrypted envelopes", async () => {
    const created = await POST(request("", "POST", { name: "API engine", url: "http://api.test:8000" }), { params: Promise.resolve({}) });
    expect(created.status).toBe(201); expect(created.headers.get("Cache-Control")).toBe("no-store");
    const data = await created.json();
    expect(data).toMatchObject({ ok: true, token: expect.stringMatching(/^[a-f0-9]{48}$/), envLine: `EVO_SECRET_TOKEN=${data.token}` });
    const get = await GET(request(""), { params: Promise.resolve({}) }), list = await get.json();
    expect(list).toMatchObject({ managed: true, engines: [expect.objectContaining({ id: data.engine.id, tokenMask: `••••${data.token.slice(-4)}` })] });
    expect(JSON.stringify(list)).not.toContain(data.token); expect(JSON.stringify(list)).not.toContain("enc:v1:");
    const params = { params: Promise.resolve({ id: data.engine.id }) };
    expect((await PATCH(request(`/${data.engine.id}`, "PATCH", { name: "API renamed" }), params)).status).toBe(200);
    const rotation = await ROTATE(request(`/${data.engine.id}/rotate-token`, "POST"), params);
    const next = await rotation.json(); expect(next.token).not.toBe(data.token); expect(rotation.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify(await (await GET(request(""), { params: Promise.resolve({}) })).json())).not.toContain(next.token);
    expect((await DELETE(request(`/${data.engine.id}`, "DELETE"), params)).status).toBe(409);
    expect((await DELETE(request(`/${data.engine.id}?force=1`, "DELETE"), params)).status).toBe(200);
  });
  it("enforces admin auth and rejects malformed, duplicate and unsafe inputs", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 403 }));
    expect((await GET(request(""), { params: Promise.resolve({}) })).status).toBe(403);
    for (const body of [{ name: "Bad", url: "http://169.254.169.254" }, { name: "Bad", url: "file:///tmp" }, { name: "Bad", url: "http://valid.test", token: "short" }, { url: "http://valid.test" }]) {
      expect((await POST(request("", "POST", body), { params: Promise.resolve({}) })).status).toBe(400);
    }
    const body = { name: "Duplicate", url: "http://duplicate-api.test:8000" };
    expect((await POST(request("", "POST", body), { params: Promise.resolve({}) })).status).toBe(201);
    expect((await POST(request("", "POST", body), { params: Promise.resolve({}) })).status).toBe(409);
    expect((await client.query("select * from evo_engines")).rows).toHaveLength(1);
  });
  it("rolls back engine mutations when their audit insert fails", async () => {
    await client.exec("alter table config_audit add constraint registry_test_actor check (actor <> 'deny-fixture')");
    try {
      await expect(addEngine({ name: "Atomic", url: "http://atomic.test:8000" }, "deny-fixture")).rejects.toThrow(/Could not save/);
      expect((await client.query("select * from evo_engines")).rows).toEqual([]);
    } finally { await client.exec("alter table config_audit drop constraint registry_test_actor"); }
  });
});


describe("registry cache", () => {
  it("shares one registry query across concurrent task and token lookups, then expires", async () => {
    const added = await addEngine({ name: "Cached", url: "http://cache.test" }, actor);
    const { recordTask } = await import("@/lib/evo/scheduler");
    await recordTask("cache-owned", added.engine, "ingest");
    invalidateEngineCache();
    const select = vi.spyOn(database.db, "select");
    try {
      await Promise.all(Array.from({ length: 20 }, () => Promise.all([engineForTask("cache-owned"), engineToken(added.engine.id)])));
      expect(select).toHaveBeenCalledTimes(1);
      const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11_000);
      try { await engineToken(added.engine.id); expect(select).toHaveBeenCalledTimes(2); }
      finally { now.mockRestore(); }
    } finally { select.mockRestore(); }
  });
  it("does not cache failed queries", async () => {
    const select = vi.spyOn(database.db, "select").mockImplementationOnce(() => ({ from: () => Promise.reject(new Error("offline")) }) as unknown as ReturnType<typeof database.db.select>);
    try {
      await expect(registeredEngines()).rejects.toThrow("offline");
      expect(await registeredEngines()).toHaveLength(1);
      expect(select).toHaveBeenCalledTimes(2);
    } finally { select.mockRestore(); }
  });
  it.each([401, 403])("retries %s once only when a cached credential changed", async (status) => {
    const added = await addEngine({ name: "Rotating", url: "http://rotate.test" }, actor);
    await engineToken(added.engine.id);
    const { encryptSecret } = await import("@/lib/config/crypto");
    fetchMock.mockImplementationOnce(async () => {
      await client.query("update evo_engines set token = $1 where id = $2", [encryptSecret("new-remote-credential"), added.engine.id]);
      return new Response(null, { status });
    }).mockResolvedValueOnce(new Response(null, { status }));
    expect((await engineFetch("/queue", { engine: added.engine })).status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.lastCall?.[1].headers["X-Evo-Secret"]).toBe("new-remote-credential");
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status }));
    await engineFetch("/queue", { engine: added.engine });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("invalidates cached rows after add, update, rotation and removal", async () => {
    await registeredEngines();
    const added = await addEngine({ name: "Before", url: "http://invalidate.test" }, actor);
    expect((await registeredEngines())[0].name).toBe("Before");
    await updateEngine(added.engine.id, { name: "After" }, actor);
    expect((await registeredEngines())[0].name).toBe("After");
    await engineToken(added.engine.id);
    const next = await rotateEngineToken(added.engine.id, actor);
    expect(await engineToken(added.engine.id)).toBe(next.token);
    await removeEngine(added.engine.id, actor, true);
    await expect(engineToken(added.engine.id)).rejects.toThrow("removed");
    expect((await registeredEngines()).some(e => e.id === added.engine.id)).toBe(false);
  });
});

it("does not let an in-flight read repopulate rows invalidated by a mutation", async () => {
  let resolve!: (rows: never[]) => void;
  const pending = new Promise<never[]>(done => { resolve = done; });
  const select = vi.spyOn(database.db, "select").mockImplementationOnce(() => ({ from: () => pending }) as unknown as ReturnType<typeof database.db.select>);
  try {
    const stale = registeredEngines();
    const added = await addEngine({ name: "Concurrent", url: "http://concurrent.test" }, actor);
    resolve([]);
    await stale;
    expect((await registeredEngines()).map(e => e.id)).toEqual([added.engine.id]);
  } finally { select.mockRestore(); }
});
