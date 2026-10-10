import { NextResponse } from "next/server";
import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/cms/api";
import { TEMPLATE_ITEMS, buildCsv, buildJson, loadExportItems } from "@/lib/cms/provider-io";

const query = z.object({
  format: z.enum(["csv", "json"]).default("json"),
  type: z.enum(["all", "movies", "episodes"]).default("all"),
  template: z.enum(["1"]).optional(),
});

export const GET = adminRoute(async (req) => {
  const q = parseQuery(req, query);
  if ("error" in q) return q.error;
  const { format, type, template } = q.data;

  const items = template ? TEMPLATE_ITEMS : await loadExportItems(type);
  const body = format === "csv" ? buildCsv(items) : buildJson(items);
  const day = new Date().toISOString().slice(0, 10);
  const name = template ? `evolix-providers-template.${format}` : `evolix-providers-${day}.${format}`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
