import { describe, expect, it, vi } from "vitest";
import { getConfig } from "@/lib/config";

vi.mock("@/lib/config", () => ({ getConfig: vi.fn() }));
import { engines, engineById } from "@/lib/evo/client";
import { isEngineCall } from "@/lib/evo/engine";
import { viewerStreamUrl } from "@/lib/evo/stream-url";
import { isAdminEmail } from "@/lib/auth/admin";
import { getTransporter } from "@/lib/auth/mailer";
import nodemailer from "nodemailer";
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn(() => ({ close: vi.fn() })) } }));

const config = (values: Record<string, unknown>) => vi.mocked(getConfig).mockResolvedValue(values as unknown as Awaited<ReturnType<typeof getConfig>>);
describe("asynchronous config consumers", () => {
  it("refreshes the memoised engines when the config changes", async () => {
    config({ EVO_ENGINES: '["http://first.example.test:8000"]' });
    const first = await engines(); expect(first[0].url).toContain("first.");
    expect(await engines()).toBe(first);
    config({ EVO_ENGINES: '["http://second.example.test:8000"]' });
    expect((await engines())[0].url).toContain("second.");
    expect(await engineById(first[0].id)).toBeUndefined();
  });
  it("awaits engine and admin authorization values", async () => {
    config({ EVO_SECRET_TOKEN: "fixture-engine-token", adminEmails: ["admin@example.test"] });
    expect(await isEngineCall(new Request("http://example.test"))).toBe(false);
    expect(await isEngineCall(new Request("http://example.test", { headers: { "x-evo-secret": "fixture-engine-token" } }))).toBe(true);
    expect(await isAdminEmail("ADMIN@example.test")).toBe(true);
    expect(await isAdminEmail("viewer@example.test")).toBe(false);
    config({ EVO_SECRET_TOKEN: "" });
    expect(await isEngineCall(new Request("http://example.test"))).toBe(false);
  });
  it("resolves the configured stream Worker URL as a string", async () => {
    config({ STREAM_BASE: "https://stream.example.test" });
    const url = await viewerStreamUrl("/api/v1/media/stream/12345678-1234-1234-1234-123456789abc/file.mp4", "engine");
    expect(url).toMatch(/^https:\/\/stream.example.test\/[a-f0-9]{8}\/12345678-1234-1234-1234-123456789abc\/file.mp4$/);
    config({ STREAM_BASE: "" });
    expect(await viewerStreamUrl("original", "engine")).toBe("original");
  });
  it("reuses SMTP transport until its connection settings change", async () => {
    config({ SMTP_HOST: "first", SMTP_PORT: 587, SMTP_USER: "fixture", SMTP_PASS: "fixture-password" });
    const first = await getTransporter();
    expect(await getTransporter()).toBe(first);
    config({ SMTP_HOST: "second", SMTP_PORT: 587, SMTP_USER: "fixture", SMTP_PASS: "fixture-password" });
    expect(await getTransporter()).not.toBe(first);
    expect(first.close).toHaveBeenCalledOnce();
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
  });
});
