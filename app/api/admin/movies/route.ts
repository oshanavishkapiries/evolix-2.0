import { fail, json, parseBody } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { createMovieWithVideos, findMovieIdByTmdb, listMovies } from "@/lib/cms/movies";
import { movieCreate } from "@/lib/cms/schemas";

export const GET = adminRoute(async () => json(200, { movies: await listMovies() }));

export const POST = adminRoute(async (req) => {
  const body = await parseBody(req, movieCreate);
  if ("error" in body) return body.error;
  const existing = await findMovieIdByTmdb(body.data.tmdbId);
  if (existing) return fail(409, "ALREADY_EXISTS", "This movie was already added", { id: existing });
  return json(201, { movie: await createMovieWithVideos(body.data) });
});
