import { networkInterfaces } from "node:os";
import { headers } from "next/headers";

/** Addresses of the machine serving this app, plus the host the admin used to reach it. */
export async function ServerInfo() {
  const host = (await headers()).get("host") ?? "";
  const ips = Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((n) => !n.internal && n.family === "IPv4")
    .map((n) => n.address);
  return (
    <dl className="adm-server" aria-label="Server">
      <dt>Server IP</dt>
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
