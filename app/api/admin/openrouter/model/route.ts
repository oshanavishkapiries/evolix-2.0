import { z } from "zod";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { engineFetch, engines } from "@/lib/evo/client";
import { openRouterModels } from "@/lib/openrouter";

type Row = { key: string; value: unknown };
type EngineModel = { id: string; name: string; model: string | null; error?: string };

async function current(): Promise<EngineModel[]> {
  return Promise.all(
    (await engines()).map(async (e): Promise<EngineModel> => {
      try {
        const res = await engineFetch("/config", { engine: e, timeoutMs: 8000 });
        if (!res.ok) return { id: e.id, name: e.name, model: null, error: `Engine returned ${res.status}` };
        const row = ((await res.json()) as Row[]).find((r) => r.key === "TRANSLATE_MODEL");
        return { id: e.id, name: e.name, model: typeof row?.value === "string" ? row.value : null };
      } catch {
        return { id: e.id, name: e.name, model: null, error: "The engine did not answer" };
      }
    }),
  );
}

/** The translation model each engine uses right now. */
export const GET = adminRoute(async () => json(200, { data: await current() }));

const body = z.object({ model: z.string().trim().min(3).max(120) });

/**
 * Switches the Sinhala translation model on every engine. The id must be one OpenRouter lists (when its catalogue
 * can be read), so a typo cannot make every later translation fail. It applies to the next subtitle job; subtitles
 * that already exist are not touched.
 */
export const PUT = adminRoute(async (req) => {
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { model } = parsed.data;
  const known = await openRouterModels();
  if (known.length && !known.some((m) => m.id === model)) return json(422, { message: `"${model}" is not a model OpenRouter lists. Pick one from the list.` });

  const results = await Promise.all(
    (await engines()).map(async (e) => {
      try {
        const res = await engineFetch("/config", { method: "PUT", engine: e, body: { TRANSLATE_MODEL: model }, timeoutMs: 15_000 });
        if (res.ok) return { id: e.id, name: e.name, ok: true as const };
        const detail = ((await res.json().catch(() => ({}))) as { detail?: unknown }).detail;
        return { id: e.id, name: e.name, ok: false as const, error: typeof detail === "string" ? detail : `Engine returned ${res.status}` };
      } catch {
        return { id: e.id, name: e.name, ok: false as const, error: "The engine did not answer" };
      }
    }),
  );
  return json(200, { data: { model, engines: results } });
});
