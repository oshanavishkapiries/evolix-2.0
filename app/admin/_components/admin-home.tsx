"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";

type Row = {
  id: string;
  title?: string;
  name?: string;
  releaseDate?: string | null;
  firstAirDate?: string | null;
  isPublished: boolean;
};

const year = (d?: string | null) => (d ? d.slice(0, 4) : "n/a");

export function AdminHome() {
  const [movies, setMovies] = useState<Row[] | null>(null);
  const [shows, setShows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [m, s] = await Promise.all([
        adminApi<{ movies: Row[] }>("GET", "/api/admin/movies"),
        adminApi<{ shows: Row[] }>("GET", "/api/admin/shows"),
      ]);
      if (m.ok) setMovies(m.movies);
      else setError(errorText(m));
      if (s.ok) setShows(s.shows);
      else setError(errorText(s));
    })();
  }, []);

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <section>
        <h2>Movies</h2>
        <p>
          <Link href="/admin/movies/new">Add a movie</Link>
        </p>
        {movies === null ? (
          <p>Loading...</p>
        ) : movies.length === 0 ? (
          <p>No movies yet.</p>
        ) : (
          <ul className="rows">
            {movies.map((m) => (
              <li key={m.id}>
                <span>
                  <a href={`/admin/movies/${m.id}`}>{m.title}</a> ({year(m.releaseDate)}){" "}
                </span>
                <span className={`badge ${m.isPublished ? "badge-on" : "badge-off"}`}>
                  {m.isPublished ? "published" : "draft"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2>Shows</h2>
        <p>
          <Link href="/admin/shows/new">Add a show</Link>
        </p>
        {shows === null ? (
          <p>Loading...</p>
        ) : shows.length === 0 ? (
          <p>No shows yet.</p>
        ) : (
          <ul className="rows">
            {shows.map((s) => (
              <li key={s.id}>
                <span>
                  <a href={`/admin/shows/${s.id}`}>{s.name}</a> ({year(s.firstAirDate)}){" "}
                </span>
                <span className={`badge ${s.isPublished ? "badge-on" : "badge-off"}`}>
                  {s.isPublished ? "published" : "draft"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
