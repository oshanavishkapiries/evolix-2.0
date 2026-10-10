import { networkInterfaces } from "node:os";
import { headers } from "next/headers";

/** Public address as seen from outside (cached for an hour; null when the lookup fails). */
async function publicIp(): Promise<string | null> {
  try {
    const res = await fetch("https://api.ipify.org", { next: { revalidate: 3600 }, signal: AbortSignal.timeout(2500) });
    const text = (await res.text()).trim();
    return res.ok && /^[\d.:a-f]{3,45}$/i.test(text) ? text : null;
  } catch {
    return null;
  }
}

/** Addresses of the machine serving this app, plus the host the admin used to reach it. */
export async function ServerInfo() {
  const host = (await headers()).get("host") ?? "";
  const pub = await publicIp();
  const ips = Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((n) => !n.internal && n.family === "IPv4")
    .map((n) => n.address);
  return (
    <dl className="adm-server" aria-label="Server">
      <dt>Public IP</dt>
      <dd>{pub ?? "unavailable"}</dd>
      <dt>Network IP</dt>
      <dd>{ips.length ? ips.join(", ") : "unknown"}</dd>
      {host && (
        <>
          <dt>Host</dt>
          <dd>{host}</dd>
        </>
      )}
    </dl>
  );
}
