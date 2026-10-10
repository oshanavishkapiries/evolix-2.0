"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { adminApi, errorText, tmdbImage } from "@/lib/client/admin";
import { Breadcrumbs, type Crumb } from "./breadcrumbs";
import { StatusBadge } from "./title-rows";
import { TabNav, type Tab } from "./tab-nav";
import { useToast } from "./toast";

export type EntityKind = "movie" | "show";
export type Entity = Record<string, unknown> & { id: string; tmdbId: number; isPublished: boolean };

type Ctx = {
  kind: EntityKind;
  entity: Entity;
  title: string;
  base: string;
  /** PATCHes the movie/show; toasts the result; resolves true on success. */
  patch: (body: Record<string, unknown>, success?: string) => Promise<boolean>;
};

const EntityCtx = createContext<Ctx | null>(null);
export function useEntity() {
  const c = useContext(EntityCtx);
  if (!c) throw new Error("useEntity outside EntityShell");
  return c;
}

const CONFIG = {
  movie: {
    api: "/api/admin/movies",
    base: "/admin/movies",
    list: "Movies",
    titleKey: "title",
    dateKey: "releaseDate",
    tabs: [
      ["", "Overview"],
      ["/details", "Details"],
      ["/images", "Images"],
      ["/videos", "Videos"],
      ["/sources", "Sources"],
      ["/subtitles", "Subtitles"],
    ],
  },
  show: {
    api: "/api/admin/shows",
    base: "/admin/shows",
    list: "Shows",
    titleKey: "name",
    dateKey: "firstAirDate",
    tabs: [
      ["", "Overview"],
      ["/details", "Details"],
      ["/images", "Images"],
      ["/videos", "Videos"],
      ["/seasons", "Seasons"],
    ],
  },
} as const;

/** Header (breadcrumb, poster, title, publish state) and tab bar shared by all sub-pages of a movie or show. */
export function EntityShell({ kind, initial, children }: { kind: EntityKind; initial: Entity; children: React.ReactNode }) {
  const cfg = CONFIG[kind];
  const toast = useToast();
  const pathname = usePathname();
  const [entity, setEntity] = useState(initial);
  const [busy, setBusy] = useState(false);
  const base = `${cfg.base}/${entity.id}`;
  const title = String(entity[cfg.titleKey] ?? "Untitled");
  const date = entity[cfg.dateKey];
  const year = typeof date === "string" && date ? date.slice(0, 4) : null;

  const patch = useCallback(
    async (body: Record<string, unknown>, success = "Saved.") => {
      const res = await adminApi<Record<string, Entity>>("PATCH", `${cfg.api}/${entity.id}`, body);
      if (!res.ok) {
        toast.error(errorText(res));
        return false;
      }
      setEntity((prev) => ({ ...prev, ...res[kind] }));
      toast.success(success);
      return true;
    },
    [cfg.api, entity.id, kind, toast],
  );

  const value = useMemo(() => ({ kind, entity, title, base, patch }), [kind, entity, title, base, patch]);

  const crumbs: Crumb[] = [{ label: cfg.list, href: cfg.base }];
  const m = kind === "show" ? pathname.match(/\/seasons\/(\d+)(?:\/episodes\/(\d+))?/) : null;
  if (m) {
    crumbs.push({ label: title, href: base });
    crumbs.push({ label: `Season ${m[1]}`, href: `${base}/seasons/${m[1]}` });
    if (m[2]) crumbs.push({ label: `Episode ${m[2]}` });
  } else {
    crumbs.push({ label: title, href: base });
  }
  // On the overview the title is the current page; elsewhere it links back.
  if (pathname === base) crumbs[crumbs.length - 1] = { label: title };

  const tabs: Tab[] = cfg.tabs.map(([suffix, label]) => ({ href: `${base}${suffix}`, label, exact: suffix === "" }));
  const poster = tmdbImage(entity.posterPath, "w92");

  return (
    <EntityCtx.Provider value={value}>
      <header className="space-y-3">
        <Breadcrumbs items={crumbs} />
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" width={48} height={72} className="h-[72px] w-12 shrink-0 rounded object-cover" />
          ) : (
            <span className="h-[72px] w-12 shrink-0 rounded bg-gray-200 dark:bg-gray-800" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="break-words">
              <Link href={base} className="text-inherit no-underline hover:no-underline dark:text-inherit">
                {title}
              </Link>{" "}
              {year && <span className="font-normal text-gray-500 dark:text-gray-400">({year})</span>}
            </h1>
            <p className="mt-1">
              <StatusBadge published={entity.isPublished} />
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await patch({ isPublished: !entity.isPublished }, entity.isPublished ? "Unpublished." : "Published.");
              setBusy(false);
            }}
          >
            {entity.isPublished ? "Unpublish" : "Publish"}
          </button>
        </div>
        <TabNav label={`${kind === "movie" ? "Movie" : "Show"} sections`} tabs={tabs} />
      </header>
      <div className="mt-6 space-y-6">{children}</div>
    </EntityCtx.Provider>
  );
}
