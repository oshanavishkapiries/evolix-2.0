import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { neonConfig } from "@neondatabase/serverless";
import { isLocalDatabaseUrl, configureLocalNeonProxy } from "../db";

describe("isLocalDatabaseUrl", () => {
  it("identifies localhost URLs as local", () => {
    expect(isLocalDatabaseUrl("postgres://postgres:postgres@localhost:54329/evolix_local")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://postgres:postgres@localhost:5432/evolix_local")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://localhost/evolix_local")).toBe(true);
  });

  it("identifies 127.0.0.1 IPv4 loopback URLs as local", () => {
    expect(isLocalDatabaseUrl("postgres://postgres:postgres@127.0.0.1:54329/evolix_local")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://user:pass@127.0.0.1:5432/main")).toBe(true);
  });

  it("identifies IPv6 loopback [::1] URLs as local", () => {
    expect(isLocalDatabaseUrl("postgres://postgres:postgres@[::1]:54329/evolix_local")).toBe(true);
  });

  it("identifies docker compose and host.docker.internal service names as local", () => {
    expect(isLocalDatabaseUrl("postgres://postgres:postgres@postgres:5432/evolix_local")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://postgres:postgres@host.docker.internal:5432/evolix_local")).toBe(true);
  });

  it("identifies *.localtest.me and *.localhost domains as local", () => {
    expect(isLocalDatabaseUrl("postgres://postgres:postgres@db.localtest.me:54329/evolix_local")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://postgres:postgres@sub.localhost:5432/db")).toBe(true);
  });

  it("identifies production Neon cloud URLs as non-local", () => {
    expect(
      isLocalDatabaseUrl(
        "postgresql://user:secret@ep-silent-smoke-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
      )
    ).toBe(false);
    expect(isLocalDatabaseUrl("postgres://user:secret@my-neon-db.neon.tech/neondb")).toBe(false);
  });

  it("identifies arbitrary remote URLs as non-local", () => {
    expect(isLocalDatabaseUrl("postgres://user:pass@aws.rds.amazonaws.com:5432/db")).toBe(false);
    expect(isLocalDatabaseUrl("postgres://user:pass@192.168.1.100:5432/db")).toBe(false);
  });

  it("handles empty or invalid inputs gracefully without throwing", () => {
    expect(isLocalDatabaseUrl("")).toBe(false);
    expect(isLocalDatabaseUrl("not-a-valid-url")).toBe(false);
    expect(isLocalDatabaseUrl(null as unknown as string)).toBe(false);
    expect(isLocalDatabaseUrl(undefined as unknown as string)).toBe(false);
  });
});

describe("configureLocalNeonProxy", () => {
  const originalFetchEndpoint = neonConfig.fetchEndpoint;
  const originalUseSecureWebSocket = neonConfig.useSecureWebSocket;
  const originalPipelineTLS = neonConfig.pipelineTLS;
  const originalPipelineConnect = neonConfig.pipelineConnect;

  beforeEach(() => {
    neonConfig.fetchEndpoint = originalFetchEndpoint;
    neonConfig.useSecureWebSocket = originalUseSecureWebSocket;
    neonConfig.pipelineTLS = originalPipelineTLS;
    neonConfig.pipelineConnect = originalPipelineConnect;
    delete process.env.LOCAL_NEON_PROXY_PORT;
    delete process.env.NEON_PROXY_URL;
  });

  afterEach(() => {
    neonConfig.fetchEndpoint = originalFetchEndpoint;
    neonConfig.useSecureWebSocket = originalUseSecureWebSocket;
    neonConfig.pipelineTLS = originalPipelineTLS;
    neonConfig.pipelineConnect = originalPipelineConnect;
  });

  it("configures neonConfig for local proxy when URL is local", () => {
    configureLocalNeonProxy("postgres://postgres:postgres@127.0.0.1:54329/evolix_local");
    expect(neonConfig.useSecureWebSocket).toBe(false);
    expect(neonConfig.pipelineTLS).toBe(false);
    expect(neonConfig.pipelineConnect).toBe(false);

    const fetchFn = neonConfig.fetchEndpoint as (host: string) => string;
    expect(typeof fetchFn).toBe("function");
    expect(fetchFn("127.0.0.1")).toBe("http://127.0.0.1:4444/sql");
    expect(fetchFn("localhost")).toBe("http://127.0.0.1:4444/sql");
    expect(fetchFn("postgres")).toBe("http://127.0.0.1:4444/sql");
  });

  it("does not mutate neonConfig when URL is production Neon", () => {
    configureLocalNeonProxy("postgresql://user:secret@ep-test.us-east-2.aws.neon.tech/neondb");
    expect(neonConfig.fetchEndpoint).toBe(originalFetchEndpoint);
    expect(neonConfig.useSecureWebSocket).toBe(originalUseSecureWebSocket);
    expect(neonConfig.pipelineTLS).toBe(originalPipelineTLS);
  });
});
