import { parseEncryptionKey } from "./crypto";
export function bootstrapSummary(environment: Record<string, string | undefined> = process.env): Record<string, string> {
  let database = "Not set";
  if (environment.DATABASE_URL) {
    try { const url = new URL(environment.DATABASE_URL); database = `${url.hostname}${url.port ? `:${url.port}` : ""} / ${url.pathname.slice(1)}`; }
    catch { database = "Set (invalid URL)"; }
  }
  let encryption = "Not set";
  if (environment.CONFIG_ENCRYPTION_KEY) {
    try { parseEncryptionKey(environment.CONFIG_ENCRYPTION_KEY); encryption = "Set · valid format"; }
    catch { encryption = "Set · invalid format"; }
  }
  return { DATABASE_URL: database, CONFIG_ENCRYPTION_KEY: encryption, ...Object.fromEntries(Object.entries(environment).filter((pair): pair is [string, string] => pair[0].startsWith("NEXT_PUBLIC_") && pair[1] !== undefined)) };
}
