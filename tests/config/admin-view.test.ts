import { describe, expect, it } from "vitest";
import { configChanges, configValidation, groupConfig, includesAdmin } from "@/lib/config/admin-view";
import { bootstrapSummary } from "@/lib/config/bootstrap";
describe("configuration form helpers", () => {
  it("groups registry keys and counts only real changes, keeping blank secrets", () => {
    const rows = [{ key: "SMTP_PORT", value: 587, source: "env" as const }, { key: "SMTP_PASS", value: "••••", source: "db" as const }];
    expect(groupConfig(rows).find((g) => g.group === "Mail")?.items.find((r) => r.key === "SMTP_PORT")?.source).toBe("env");
    expect(configChanges(rows, { SMTP_PORT: "587", SMTP_PASS: "" })).toEqual({});
    expect(configChanges(rows, { SMTP_PORT: "465", SMTP_PASS: "replacement" })).toEqual({ SMTP_PORT: "465", SMTP_PASS: "replacement" });
    expect(configValidation("SMTP_PORT", "bad")).toBeTruthy();
    expect(configValidation("JWT_ACCESS_SECRET", "fixture-short")).not.toContain("fixture-short");
    expect(configValidation("SMTP_PASS", "")).toBeUndefined();
    expect(includesAdmin(" OTHER@example.test, Admin@Example.test ", "admin@example.test")).toBe(true);
  });
  it("never exposes database credentials or encryption key in bootstrap", () => {
    const env = { DATABASE_URL: "postgres://fixture-user:fixture-password@db.example.test:5432/evolix?password=fixture-query", CONFIG_ENCRYPTION_KEY: "fixture-invalid", NEXT_PUBLIC_SITE: "https://example.test", SMTP_PASS: "fixture-mail" };
    const result = bootstrapSummary(env);
    expect(result.DATABASE_URL).toBe("db.example.test:5432 / evolix");
    expect(result.CONFIG_ENCRYPTION_KEY).toBe("Set · invalid format");
    expect(result.NEXT_PUBLIC_SITE).toBe(env.NEXT_PUBLIC_SITE);
    expect(JSON.stringify(result)).not.toMatch(/fixture-/);
    expect(bootstrapSummary({}).CONFIG_ENCRYPTION_KEY).toBe("Not set");
    expect(bootstrapSummary({ CONFIG_ENCRYPTION_KEY: "ab".repeat(32) }).CONFIG_ENCRYPTION_KEY).toBe("Set · valid format");
  });
});
