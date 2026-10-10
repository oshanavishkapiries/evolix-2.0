import { cookies } from "next/headers";

export type ViewMode = "rows" | "grid";
export type ViewPage = "movies" | "tv" | "my-list";

export const viewCookie = (page: ViewPage) => `v-view-${page}`;

/** ?view= wins, then the remembered choice (cookie), then the page default (spec Q12). Dynamic. */
export async function resolveView(page: ViewPage, param: string | undefined, fallback: ViewMode): Promise<ViewMode> {
  if (param === "rows" || param === "grid") return param;
  const saved = (await cookies()).get(viewCookie(page))?.value;
  return saved === "rows" || saved === "grid" ? saved : fallback;
}
