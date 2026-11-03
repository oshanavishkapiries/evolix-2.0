import { z } from "zod";
import { json, parseBody } from "@/lib/auth/http";
import { after } from "next/server";
import { engineConfigRoute } from "@/lib/evo/engine-config-api";
import { configRows, effectiveEngineConfig, saveEngineConfig } from "@/lib/evo/engine-config-store";
import { pushAffectedEngines } from "@/lib/evo/engine-config-sync";
import { engineFetch, engines } from "@/lib/evo/client";
import { openRouterModels } from "@/lib/openrouter";

type Row = { key: string; value: unknown };
type EngineModel = { id: string; name: string; model: string | null; error?: string };

async function current(): Promise<EngineModel[]> {
  return Promise.all(
    (await engines()).map(async (e): Promise<EngineModel> => {
      try {
        const desired = effectiveEngineConfig(await configRows(e.id), e.id).TRANSLATE_MODEL;
        if (typeof desired === "string") return { id: e.id, name: e.name, model: desired };
        // Legacy engines and unset models still get their default from their own environment.
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

/** Desired translation model per engine, with legacy/default reads from the engine. */
export const GET = engineConfigRoute(async () => json(200, { data: await current() }));

const body = z.object({ model: z.string().trim().min(3).max(120) });

/**
 * Switches the Sinhala translation model on every engine. The id must be one OpenRouter lists (when its catalogue
 * can be read), so a typo cannot make every later translation fail. It applies to the next subtitle job; subtitles
 * that already exist are not touched.
 */
export const PUT = engineConfigRoute(async (req, _params, actor) => {
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { model } = parsed.data;
  const known = await openRouterModels();
  if (known.length && !known.some((m) => m.id === model)) return json(422, { message: `"${model}" is not a model OpenRouter lists. Pick one from the list.` });

  const affected = await saveEngineConfig("global", { TRANSLATE_MODEL: model }, actor);
  if (affected.length) after(() => pushAffectedEngines(affected));
  // ok acknowledges the durable save; engine delivery is tracked by configuration sync status.
  const results = (await engines()).map((e) => ({ id: e.id, name: e.name, ok: true as const }));
  return json(200, { data: { model, engines: results } });
});
