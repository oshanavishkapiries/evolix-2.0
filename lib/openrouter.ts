import "server-only";
import { env } from "@/lib/env";

const BASE = "https://openrouter.ai/api/v1";

type Row = {
  date: string;
  model: string;
  usage: number;
  byok_usage_inference?: number;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
};

export type OpenRouterStats =
  | { ok: false; reason: "unconfigured" | "unauthorized" | "error"; message: string }
  | {
      ok: true;
      days: string[];
      spend: number[];
      byok: number[];
      /** Requests per model per day, top models first with the rest folded into "Other". */
      models: { model: string; values: number[] }[];
      prompt: number[];
      completion: number[];
      reasoning: number[];
      credits: { total: number; used: number } | null;
    };

async function get<T>(path: string): Promise<{ status: number; body: T | null }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, body: res.ok ? ((await res.json()) as T) : null };
}

/** OpenRouter /activity (last 30 UTC days, needs a management key) folded into per-day series. */
export async function openRouterStats(): Promise<OpenRouterStats> {
  if (!env.OPENROUTER_API_KEY) {
    return { ok: false, reason: "unconfigured", message: "Set OPENROUTER_API_KEY (a management key) to show OpenRouter analytics." };
  }
  try {
    const [act, cred] = await Promise.all([get<{ data: Row[] }>("/activity"), get<{ data: { total_credits: number; total_usage: number } }>("/credits")]);
    if (act.status === 401 || act.status === 403) {
      return { ok: false, reason: "unauthorized", message: "OpenRouter rejected the key. /activity needs a management key (sk-or-v1-...) from openrouter.ai/settings/management-keys." };
    }
    if (!act.body) return { ok: false, reason: "error", message: `OpenRouter returned ${act.status}.` };

    const rows = act.body.data;
    const days = [...new Set(rows.map((r) => r.date.slice(0, 10)))].sort().slice(-30);
    const idx = new Map(days.map((d, i) => [d, i]));
    const zeros = () => days.map(() => 0);
    const spend = zeros(), byok = zeros(), prompt = zeros(), completion = zeros(), reasoning = zeros();
    const perModel = new Map<string, number[]>();
    for (const r of rows) {
      const i = idx.get(r.date.slice(0, 10));
      if (i === undefined) continue;
      spend[i] += r.usage;
      byok[i] += r.byok_usage_inference ?? 0;
      prompt[i] += r.prompt_tokens;
      completion[i] += r.completion_tokens;
      reasoning[i] += r.reasoning_tokens;
      const m = perModel.get(r.model) ?? zeros();
      m[i] += r.requests;
      perModel.set(r.model, m);
    }
    const ranked = [...perModel.entries()].sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0));
    const models = ranked.slice(0, 5).map(([model, values]) => ({ model, values }));
    if (ranked.length > 5) models.push({ model: "Other", values: days.map((_, i) => ranked.slice(5).reduce((a, [, v]) => a + v[i], 0)) });
    return {
      ok: true,
      days,
      spend,
      byok,
      models,
      prompt,
      completion,
      reasoning,
      credits: cred.body ? { total: cred.body.data.total_credits, used: cred.body.data.total_usage } : null,
    };
  } catch {
    return { ok: false, reason: "error", message: "Could not reach OpenRouter." };
  }
}
