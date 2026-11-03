import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "../lib/env";
import * as schema from "./schema";

export function isLocalDatabaseUrl(urlString: string): boolean {
  if (!urlString || typeof urlString !== "string") return false;
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname === "postgres" ||
      hostname === "host.docker.internal" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".localtest.me")
    );
  } catch {
    return false;
  }
}

export function configureLocalNeonProxy(databaseUrl: string): void {
  if (!isLocalDatabaseUrl(databaseUrl)) return;
  const proxyPort = process.env.LOCAL_NEON_PROXY_PORT || "4444";
  neonConfig.fetchEndpoint = (host) => {
    if (process.env.NEON_PROXY_URL) return process.env.NEON_PROXY_URL;
    const targetHost =
      host === "localhost" || host === "127.0.0.1" || host === "postgres"
        ? "127.0.0.1"
        : host;
    return `http://${targetHost}:${proxyPort}/sql`;
  };
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
}

const connect = () => {
  const url = env.DATABASE_URL;
  if (isLocalDatabaseUrl(url)) {
    configureLocalNeonProxy(url);
  }
  return drizzle(neon(url), { schema });
};
let client: ReturnType<typeof connect> | undefined;

// Connects on first use, not at import, so `next build` works without DATABASE_URL.
export const db = new Proxy({} as ReturnType<typeof connect>, {
  get(_, key) {
    const real = (client ??= connect());
    const value = Reflect.get(real, key, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
