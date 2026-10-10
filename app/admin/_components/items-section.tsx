"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { EntityFields, FieldDef, FormValues, fromForm, toForm } from "./fields";

type Item = Record<string, unknown> & { id: string };
export type Parent = { movieId: string } | { episodeId: string };

const SOURCE_DEFS: FieldDef[] = [
  { key: "label", label: "Label", kind: "text" },
  { key: "kind", label: "Kind", kind: "select", options: ["direct", "hls", "embed"], def: "direct" },
  { key: "url", label: "URL", kind: "text" },
  { key: "quality", label: "Quality", kind: "ntext" },
  { key: "sortOrder", label: "Order", kind: "int", def: "0" },
  { key: "isActive", label: "Active", kind: "bool", def: true },
];

const SUBTITLE_DEFS: FieldDef[] = [
  { key: "label", label: "Label", kind: "text" },
  { key: "language", label: "Language (e.g. en)", kind: "text" },
  { key: "url", label: "URL", kind: "text" },
  { key: "format", label: "Format", kind: "select", options: ["vtt", "srt"], def: "vtt" },
  { key: "sortOrder", label: "Order", kind: "int", def: "0" },
];

function Section({
  title,
  endpoint,
  listKey,
  defs,
  parent,
  summary,
}: {
  title: string;
  endpoint: string;
  listKey: string;
  defs: FieldDef[];
  parent: Parent;
  summary: (i: Item) => string;
}) {
  const query = new URLSearchParams(parent).toString();
  const [items, setItems] = useState<Item[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>(() => toForm({}, defs));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await adminApi<Record<string, Item[]>>("GET", `${endpoint}?${query}`);
    if (res.ok) setItems(res[listKey]);
    else setError(errorText(res));
  }, [endpoint, query, listKey]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function reset() {
    setEditing(null);
    setValues(toForm({}, defs));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = fromForm(values, defs);
    if ("error" in parsed) return setError(parsed.error);
    setBusy(true);
    setError("");
    const res = editing
      ? await adminApi("PATCH", `${endpoint}/${editing}`, parsed.data)
      : await adminApi("POST", endpoint, { ...parent, ...parsed.data });
    setBusy(false);
    if (!res.ok) return setError(errorText(res));
    reset();
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this item?")) return;
    const res = await adminApi("DELETE", `${endpoint}/${id}`);
    if (!res.ok) return setError(errorText(res));
    if (editing === id) reset();
    await load();
  }

  return (
    <section>
      <h3>{title}</h3>
      {items === null ? (
        <p>Loading...</p>
      ) : items.length === 0 ? (
        <p>None yet.</p>
      ) : (
        <ul>
          {items.map((i) => (
            <li key={i.id}>
              {summary(i)}{" "}
              <button
                type="button"
                onClick={() => {
                  setEditing(i.id);
                  setValues(toForm(i, defs));
                }}
              >
                Edit
              </button>{" "}
              <button type="button" onClick={() => remove(i.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit}>
        <fieldset>
          <legend>{editing ? `Edit ${title.toLowerCase()} entry` : `Add ${title.toLowerCase()} entry`}</legend>
          <EntityFields defs={defs} values={values} onChange={setValues} />
          <button type="submit" disabled={busy}>
            {editing ? "Save changes" : "Add"}
          </button>
          {editing && (
            <>
              {" "}
              <button type="button" onClick={reset}>
                Cancel edit
              </button>
            </>
          )}
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

/** Sources + subtitles management for a movie or an episode. */
export function MediaManager({ parent }: { parent: Parent }) {
  return (
    <>
      <Section
        title="Sources"
        endpoint="/api/admin/sources"
        listKey="sources"
        defs={SOURCE_DEFS}
        parent={parent}
        summary={(i) =>
          `[${i.sortOrder}] ${i.label} (${i.kind}${i.quality ? `, ${i.quality}` : ""}${i.isActive ? "" : ", inactive"}) ${i.url}`
        }
      />
      <Section
        title="Subtitles"
        endpoint="/api/admin/subtitles"
        listKey="subtitles"
        defs={SUBTITLE_DEFS}
        parent={parent}
        summary={(i) => `[${i.sortOrder}] ${i.label} (${i.language}, ${i.format}) ${i.url}`}
      />
    </>
  );
}
