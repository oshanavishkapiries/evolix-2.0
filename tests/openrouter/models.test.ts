import { afterEach, describe, expect, it, vi } from "vitest";
import { openRouterModels } from "@/lib/openrouter";

const row = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `Name of ${id}`, context_length: 128000, pricing: { prompt: "0.0000001", completion: "0.0000004" }, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, ...over });
const catalogue = (data: unknown[], ok = true) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => ({ data }) })));
afterEach(() => vi.unstubAllGlobals());

describe("the model list on the OpenRouter page", () => {
  it("lists text models with their price per million tokens, sorted", async () => {
    catalogue([row("zeta/model"), row("google/gemini-3.1-flash-lite")]);
    const list = await openRouterModels();
    expect(list.map((m) => m.id)).toEqual(["google/gemini-3.1-flash-lite", "zeta/model"]);
    expect(list[0]).toMatchObject({ promptPer1M: 0.1, completionPer1M: 0.4, context: 128000 });
  });

  it("leaves out models that make images or audio", async () => {
    catalogue([row("a/text"), row("a/image", { architecture: { input_modalities: ["text"], output_modalities: ["text", "image"] } }), row("a/audio", { architecture: { input_modalities: ["audio"], output_modalities: ["text"] } })]);
    expect((await openRouterModels()).map((m) => m.id)).toEqual(["a/text"]);
  });

  it("treats missing or odd prices as free instead of breaking the page", async () => {
    catalogue([row("a/free", { pricing: { prompt: "-1", completion: "x" } }), row("a/none", { pricing: undefined })]);
    const list = await openRouterModels();
    expect(list.map((m) => [m.promptPer1M, m.completionPer1M])).toEqual([[0, 0], [0, 0]]);
  });

  it("is empty when OpenRouter cannot be reached, so the engines' own check still applies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await openRouterModels()).toEqual([]);
    catalogue([], false);
    expect(await openRouterModels()).toEqual([]);
  });
});
