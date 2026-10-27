import { z } from "zod";
import { parseBody } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

const id = (v: string) => encodeURIComponent(v);
const ids = z.array(z.string().max(40)).max(1000).default([]);

export const GET = adminRoute<{ id: string }>(async (req, p) => engineProxyFor(req, "GET", `/cdn/albums/${id(p.id)}`));

/** Rename an album and/or add and remove files. */
export const PUT = adminRoute<{ id: string }>(async (req, p) => {
  const parsed = await parseBody(req, z.object({ title: z.string().trim().max(200).default(""), add: ids, remove: ids }));
  if ("error" in parsed) return parsed.error;
  return engineProxyFor(req, "PUT", `/cdn/albums/${id(p.id)}`, parsed.data);
});

/** Deletes the album only; its files stay. */
export const DELETE = adminRoute<{ id: string }>(async (req, p) => engineProxyFor(req, "DELETE", `/cdn/albums/${id(p.id)}`));
