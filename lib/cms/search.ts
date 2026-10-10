import { and, eq, ilike, or, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";

/** Escapes LIKE wildcards so user input matches literally (Postgres default escape is backslash). */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/** Query string of the admin list endpoints. Without page/pageSize the whole list is returned. */
export const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["published", "draft"]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});
export type ListParams = z.infer<typeof listQuery>;

/** WHERE clause for a title list: case-insensitive match on any text column plus a status filter. */
export function listWhere(p: ListParams, textColumns: AnyColumn[], published: AnyColumn): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  if (p.q) {
    const pattern = `%${escapeLike(p.q)}%`;
    parts.push(or(...textColumns.map((c) => ilike(c, pattern))));
  }
  if (p.status) parts.push(eq(published, p.status === "published"));
  return and(...parts);
}

/** Limit/offset from list params, or undefined when the caller wants everything. */
export function pageWindow(p: ListParams) {
  if (p.page === undefined && p.pageSize === undefined) return null;
  const pageSize = p.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = p.page ?? 1;
  return { limit: pageSize, offset: (page - 1) * pageSize, page, pageSize };
}
