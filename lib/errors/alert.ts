import "server-only";
import { env } from "@/lib/env";
import { getTransporter } from "@/lib/auth/mailer";

type Alert = { id: string; kind: "new" | "regression"; source: string; type: string; message: string; culprit: string; url?: string | null; release?: string | null };

/** Email (ERROR_ALERT_EMAILS, else the admins) and an optional Discord/Slack-compatible webhook. Never throws. */
export async function sendAlert(a: Alert) {
  const link = env.APP_URL ? `${env.APP_URL.replace(/\/$/, "")}/admin/errors/${a.id}` : `/admin/errors/${a.id}`;
  const head = a.kind === "new" ? "New error" : "Regression (was resolved)";
  const lines = [`${head} [${a.source}]: ${a.type}: ${a.message}`, a.culprit && `at ${a.culprit}`, a.url && `URL: ${a.url}`, a.release && `Release: ${a.release}`, link].filter(Boolean) as string[];
  const text = lines.join("\n");
  const jobs: Promise<unknown>[] = [];

  const to = (env.ERROR_ALERT_EMAILS || env.ADMIN_EMAILS).split(",").map((e) => e.trim()).filter(Boolean);
  if (to.length && env.ERROR_ALERT_EMAIL !== "off") {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    jobs.push(
      getTransporter().sendMail({
        from: env.SMTP_FROM,
        to,
        subject: `[Evolix] ${head}: ${a.type}: ${a.message}`.slice(0, 180),
        text,
        html: `<p><b>${esc(head)}</b> on ${esc(a.source)}</p><pre style="white-space:pre-wrap">${esc(`${a.type}: ${a.message}`)}</pre>${a.culprit ? `<p>at <code>${esc(a.culprit)}</code></p>` : ""}${a.url ? `<p>URL: ${esc(a.url)}</p>` : ""}<p><a href="${esc(link)}">Open in admin</a></p>`,
      }),
    );
  }
  if (env.ERROR_ALERT_WEBHOOK) {
    // `content` is read by Discord, `text` by Slack and most others.
    const body = JSON.stringify({ content: text.slice(0, 1900), text });
    jobs.push(fetch(env.ERROR_ALERT_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(8000) }));
  }
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === "rejected") console.error("[errors] alert failed:", r.reason instanceof Error ? r.reason.message : r.reason);
}
