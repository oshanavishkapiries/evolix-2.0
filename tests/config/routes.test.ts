import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mock = vi.hoisted(() => ({ auth: vi.fn(), raw: vi.fn(), batch: vi.fn(), reset: vi.fn(), rollback: vi.fn(), list: vi.fn(), audit: vi.fn(), fallback: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: mock.auth }));
vi.mock("@/lib/config", () => ({ getRawConfigForAdmin: mock.raw, fallbackValue: mock.fallback }));
vi.mock("@/lib/config/index", () => ({ getRawConfigForAdmin: mock.raw, fallbackValue: mock.fallback }));
vi.mock("@/lib/config/store", () => ({ setConfigBatch: mock.batch, resetConfig: mock.reset, rollbackConfig: mock.rollback }));
vi.mock("@/lib/config/repository", () => ({ configRepository: { listAudit: mock.list, auditById: mock.audit } }));
import { GET, PUT } from "@/app/api/admin/config/route";
import { DELETE } from "@/app/api/admin/config/[key]/route";
import { GET as auditGet } from "@/app/api/admin/config/audit/route";
import { POST } from "@/app/api/admin/config/audit/[id]/rollback/route";
const id = "11111111-1111-4111-8111-111111111111";
const ctx = (params = {}) => ({ params: Promise.resolve(params) });
const req = (method = "GET", body?: unknown, query = "") => new NextRequest(`http://localhost/api/admin/config${query}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) });
beforeEach(() => {
  vi.resetAllMocks();
  mock.auth.mockResolvedValue({ email: "admin@example.test", id: "admin" });
  mock.raw.mockResolvedValue([{ key: "SMTP_PASS", source: "db", value: "••••word" }]);
  mock.list.mockResolvedValue([]);
  mock.fallback.mockReturnValue("admin@example.test");
});
describe("admin configuration routes", () => {
  it("authorizes every handler before reading or writing configuration", async () => {
    for (const status of [401, 403]) {
      mock.auth.mockResolvedValue(NextResponse.json({ ok: false }, { status }));
      for (const handler of [GET, PUT, DELETE, auditGet, POST]) expect((await handler(req(), ctx({ key: "SMTP_PASS", id }))).status).toBe(status);
    }
    for (const fn of [mock.raw, mock.batch, mock.reset, mock.rollback, mock.list, mock.audit]) expect(fn).not.toHaveBeenCalled();
  });
  it("returns masked snapshots and signs writes with the acting admin email", async () => {
    expect(JSON.stringify(await (await GET(req(), ctx())).json())).toContain("••••word");
    const res = await PUT(req("PUT", { SMTP_PASS: "fixture-replacement" }), ctx());
    expect(res.status).toBe(200);
    expect(mock.batch).toHaveBeenCalledWith({ SMTP_PASS: "fixture-replacement" }, "admin@example.test");
    expect(JSON.stringify(await res.json())).not.toContain("fixture-replacement");
    expect((await DELETE(req("DELETE"), ctx({ key: "SMTP_PASS" }))).status).toBe(200);
    expect(mock.reset).toHaveBeenCalledWith("SMTP_PASS", "admin@example.test");
  });
  it("validates all keys and refuses self-lockout before any write", async () => {
    const res = await PUT(req("PUT", { SMTP_PORT: 0, JWT_ACCESS_SECRET: "fixture-short", ADMIN_EMAILS: "other@example.test" }), ctx());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(Object.keys(body.errors)).toHaveLength(3);
    expect(body.errors.ADMIN_EMAILS).toMatch(/own admin email/);
    expect(JSON.stringify(body)).not.toContain("fixture-short");
    expect(mock.batch).not.toHaveBeenCalled();
    expect((await PUT(req("PUT", { SMTP_PASS: "" }), ctx())).status).toBe(200);
  });
  it("returns sanitized write failures even when a repository exception contains secrets", async () => {
    mock.batch.mockRejectedValue(new Error("fixture-secret-in-database-error"));
    const res = await PUT(req("PUT", { SMTP_PORT: 465 }), ctx());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("fixture-secret");
  });
  it("masks secret history defensively and provides paging", async () => {
    mock.list.mockResolvedValue(Array.from({ length: 3 }, (_, i) => ({ id: id.replace(/1$/, String(i + 1)), key: "SMTP_PASS", scope: "app", oldValue: "fixture-old-secret", newValue: "fixture-new-secret", actor: "admin@example.test", action: "set", at: new Date("2026-01-01") })));
    const res = await auditGet(req("GET", undefined, "?limit=2&key=SMTP_PASS"), ctx());
    const body = await res.json();
    expect(body.data).toHaveLength(2); expect(body.next).toBeTruthy();
    expect(body.data[0].canRollback).toBe(false);
    expect(JSON.stringify(body)).not.toContain("fixture-");
    await auditGet(req("GET", undefined, `?before=${body.next}`), ctx());
    expect(mock.list.mock.calls[1][0].before.at).toBeInstanceOf(Date);
  });
  it("refuses secret rollback and ADMIN_EMAILS self-lockout; restores other entries", async () => {
    mock.audit.mockResolvedValue({ key: "SMTP_PASS", scope: "app", oldValue: "••••" });
    expect((await POST(req("POST"), ctx({ id }))).status).toBe(422);
    mock.audit.mockResolvedValue({ key: "ADMIN_EMAILS", scope: "app", oldValue: '"other@example.test"' });
    expect((await POST(req("POST"), ctx({ id }))).status).toBe(422);
    expect(mock.rollback).not.toHaveBeenCalled();
    mock.audit.mockResolvedValue({ key: "SMTP_PORT", scope: "app", oldValue: "587" });
    expect((await POST(req("POST"), ctx({ id }))).status).toBe(200);
    expect(mock.rollback).toHaveBeenCalledWith(id, "admin@example.test");
  });
  it("rejects malformed inputs and pagination without touching the repository", async () => {
    expect((await PUT(req("PUT", []), ctx())).status).toBe(400);
    expect((await DELETE(req("DELETE"), ctx({ key: "UNKNOWN" }))).status).toBe(404);
    for (const query of ["?limit=0", "?limit=101", "?before=bad", "?key=UNKNOWN"]) expect((await auditGet(req("GET", undefined, query), ctx())).status).toBe(400);
    expect(mock.list).not.toHaveBeenCalled();
    expect((await POST(req("POST"), ctx({ id: "bad" }))).status).toBe(400);
  });
});

it("refuses reset to a missing required fallback or an admin list that removes the actor", async () => {
  mock.fallback.mockReturnValue(undefined);
  const missing = await DELETE(req("DELETE"), ctx({ key: "SMTP_PASS" }));
  expect(missing.status).toBe(422);
  expect(mock.reset).not.toHaveBeenCalled();
  mock.fallback.mockReturnValue("other@example.test");
  const lockout = await DELETE(req("DELETE"), ctx({ key: "ADMIN_EMAILS" }));
  expect(lockout.status).toBe(422);
  expect(mock.reset).not.toHaveBeenCalled();
});
