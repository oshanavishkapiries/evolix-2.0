import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: vi.fn(async () => ({ id: "admin", email: "admin@test" })) }));
vi.mock("@/lib/cms/catalog-invalidation", () => ({ prepareCatalogInvalidation: vi.fn() }));
vi.mock("@/lib/errors/capture", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/tmdb", () => ({ TmdbError: class extends Error {} }));
vi.mock("@/lib/evo/client", () => ({
  defaultEngine: vi.fn(async () => ({ id: "primary", url: "http://primary" })),
  engineById: vi.fn(async (id: string) => id === "second" ? { id, url: "http://second" } : null),
  engineFetch: vi.fn(),
  EngineUnavailableError: class extends Error {},
}));
import { requireAdmin } from "@/lib/auth/admin";
import { engineFetch, EngineUnavailableError } from "@/lib/evo/client";
import { GET } from "@/app/api/admin/evo/cdn/local/usage/route";
import { POST } from "@/app/api/admin/evo/cdn/local/purge/route";
import { ENGINE_CONFIG_BY_KEY, validateEngineValue } from "@/lib/evo/engine-config";
const ctx = { params: Promise.resolve({}) };
const req = (method = "GET", query = "?engine=second") => new NextRequest(`http://app/api/admin/evo/cdn/local/${method === "GET" ? "usage" : "purge"}${query}`, { method });
const pools = { videos: { used_bytes: 12, quota_bytes: 20, file_count: 2, oldest: 123 }, subtitles: { used_bytes: 0, quota_bytes: 5, file_count: 0, oldest: null } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ id: "admin", email: "admin@test" });
  vi.mocked(engineFetch).mockImplementation(async (path) => Response.json(path === "/config" ? [{ key: "CDN_PROVIDER", value: "local" }, { key: "PIXELDRAIN_API_KEY", value: "never-expose" }] : pools));
});
describe("local CDN admin proxy", () => {
  it.each([401, 403])("guards usage and purge for %i before contacting an engine", async (status) => {
    vi.mocked(requireAdmin).mockResolvedValue(NextResponse.json({ ok: false }, { status }));
    expect((await GET(req(), ctx)).status).toBe(status);
    expect((await POST(req("POST"), ctx)).status).toBe(status);
    expect(engineFetch).not.toHaveBeenCalled();
  });
  it("reports live provider and pool usage for the selected engine without configuration secrets", async () => {
    const response = await GET(req(), ctx);
    expect(await response.json()).toEqual({ ok: true, data: { ...pools, provider: "local" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(engineFetch).toHaveBeenCalledWith("/cdn/local/usage", expect.objectContaining({ engine: { id: "second", url: "http://second" } }));
  });
  it("reports inactive Pixeldrain storage and supports the default engine", async () => {
    vi.mocked(engineFetch).mockResolvedValueOnce(Response.json([{ key: "CDN_PROVIDER", value: "pixeldrain" }]));
    expect((await (await GET(req("GET", ""), ctx)).json()).data.provider).toBe("pixeldrain");
    expect(engineFetch).toHaveBeenCalledWith("/config", expect.objectContaining({ engine: { id: "primary", url: "http://primary" } }));
  });
  it("keeps Pixeldrain controls available on older engines without local endpoints", async () => {
    vi.mocked(engineFetch).mockResolvedValueOnce(Response.json([]));
    expect((await (await GET(req(), ctx)).json()).data.provider).toBe("pixeldrain");
    expect(engineFetch).toHaveBeenCalledTimes(1);
  });
  it("purges only the selected engine and preserves deleted/pinned counts", async () => {
    vi.mocked(engineFetch).mockResolvedValueOnce(Response.json({ deleted: 3, pinned: 1, usage: pools }));
    const response = await POST(req("POST"), ctx);
    expect((await response.json()).data).toMatchObject({ deleted: 3, pinned: 1 });
    expect(engineFetch).toHaveBeenCalledWith("/cdn/local/purge", expect.objectContaining({ method: "POST", body: undefined, engine: { id: "second", url: "http://second" } }));
  });
  it("rejects unknown engines and preserves refusal and unavailable responses", async () => {
    expect((await GET(req("GET", "?engine=missing"), ctx)).status).toBe(404);
    expect(engineFetch).not.toHaveBeenCalled();
    vi.mocked(engineFetch).mockResolvedValueOnce(Response.json({ detail: "Busy" }, { status: 409 }));
    expect((await POST(req("POST"), ctx)).status).toBe(409);
    vi.mocked(engineFetch).mockRejectedValueOnce(new EngineUnavailableError("offline"));
    expect((await GET(req(), ctx)).status).toBe(502);
  });
});
describe("local CDN configuration validation", () => {
  it("accepts ordinary trimmed paths independently of model-id validation", () => {
    expect(validateEngineValue("LOCAL_CDN_DIR", " /app/cdn data ")).toBe("/app/cdn data");
    expect(validateEngineValue("LOCAL_CDN_DIR", "./cdn")).toBe("./cdn");
    expect(validateEngineValue("LOCAL_CDN_DIR", "a".repeat(4096))).toHaveLength(4096);
    expect(ENGINE_CONFIG_BY_KEY.get("LOCAL_CDN_DIR")?.group).toBe("Callbacks and storage");
  });
  it.each(["", "  ", "a".repeat(4097), "a\nb", "\t/cdn", "a\x00b", 12, null])("rejects invalid paths %#", (value) => {
    expect(() => validateEngineValue("LOCAL_CDN_DIR", value)).toThrow();
  });
  it("validates provider choices and finite nonnegative quota bounds", () => {
    expect(validateEngineValue("CDN_PROVIDER", "local")).toBe("local");
    expect(validateEngineValue("CDN_PROVIDER", "pixeldrain")).toBe("pixeldrain");
    expect(() => validateEngineValue("CDN_PROVIDER", "other")).toThrow();
    for (const key of ["LOCAL_CDN_VIDEO_GB", "LOCAL_CDN_SUBTITLE_GB"]) {
      for (const value of [0, 0.5, 1000000]) expect(validateEngineValue(key, value)).toBe(value);
      for (const value of [-1, 1000001, Infinity, NaN, "5"]) expect(() => validateEngineValue(key, value)).toThrow();
    }
  });
});
