"use client";

export type FieldKind =
  | "text"
  | "ntext" // empty string becomes null
  | "textarea"
  | "int"
  | "float"
  | "date"
  | "path"
  | "list" // comma separated
  | "json"
  | "bool"
  | "select";

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  def?: string | boolean;
};
export type FormValues = Record<string, string | boolean>;

export function toForm(obj: Record<string, unknown>, defs: FieldDef[]): FormValues {
  const out: FormValues = {};
  for (const d of defs) {
    const v = obj[d.key];
    if (d.kind === "bool") out[d.key] = typeof v === "boolean" ? v : Boolean(d.def);
    else if (v === undefined || v === null) out[d.key] = typeof d.def === "string" ? d.def : "";
    else if (d.kind === "list") out[d.key] = (v as string[]).join(", ");
    else if (d.kind === "json") out[d.key] = JSON.stringify(v, null, 2);
    else out[d.key] = String(v);
  }
  return out;
}

export function fromForm(
  values: FormValues,
  defs: FieldDef[],
): { data: Record<string, unknown> } | { error: string } {
  const data: Record<string, unknown> = {};
  for (const d of defs) {
    const v = values[d.key];
    if (d.kind === "bool") data[d.key] = v === true;
    else {
      const s = String(v ?? "").trim();
      if (d.kind === "int" || d.kind === "float") data[d.key] = s === "" ? null : Number(s);
      else if (d.kind === "date" || d.kind === "path" || d.kind === "ntext") data[d.key] = s || null;
      else if (d.kind === "list") data[d.key] = s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
      else if (d.kind === "json") {
        try {
          data[d.key] = s ? JSON.parse(s) : [];
        } catch {
          return { error: `${d.label} is not valid JSON` };
        }
      } else data[d.key] = s;
    }
  }
  return { data };
}

export function EntityFields({
  defs,
  values,
  onChange,
}: {
  defs: FieldDef[];
  values: FormValues;
  onChange: (next: FormValues) => void;
}) {
  const set = (key: string, v: string | boolean) => onChange({ ...values, [key]: v });
  return (
    <div className="fields">
      {defs.map((d) => (
        <p key={d.key} className={d.kind === "textarea" || d.kind === "json" ? "wide" : undefined}>
          <label>
            {d.label}{" "}
            {d.kind === "bool" ? (
              <input
                type="checkbox"
                checked={values[d.key] === true}
                onChange={(e) => set(d.key, e.target.checked)}
              />
            ) : d.kind === "textarea" || d.kind === "json" ? (
              <textarea
                rows={d.kind === "json" ? 6 : 4}
                value={String(values[d.key] ?? "")}
                onChange={(e) => set(d.key, e.target.value)}
              />
            ) : d.kind === "select" ? (
              <select value={String(values[d.key] ?? "")} onChange={(e) => set(d.key, e.target.value)}>
                {d.options?.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={d.kind === "date" ? "date" : d.kind === "int" || d.kind === "float" ? "number" : "text"}
                step={d.kind === "float" ? "any" : undefined}
                value={String(values[d.key] ?? "")}
                onChange={(e) => set(d.key, e.target.value)}
              />
            )}
          </label>
        </p>
      ))}
    </div>
  );
}

export const MOVIE_DEFS: FieldDef[] = [
  { key: "title", label: "Title", kind: "text" },
  { key: "originalTitle", label: "Original title", kind: "text" },
  { key: "tagline", label: "Tagline", kind: "text" },
  { key: "overview", label: "Overview", kind: "textarea" },
  { key: "releaseDate", label: "Release date", kind: "date" },
  { key: "runtimeMinutes", label: "Runtime (minutes)", kind: "int" },
  { key: "genres", label: "Genres (comma separated)", kind: "list" },
  { key: "rating", label: "Rating (0-10)", kind: "float" },
  { key: "voteCount", label: "Vote count", kind: "int" },
  { key: "originalLanguage", label: "Original language", kind: "text" },
  { key: "status", label: "Status", kind: "text" },
  { key: "posterPath", label: "Poster path", kind: "path" },
  { key: "backdropPath", label: "Backdrop path", kind: "path" },
  { key: "logoPath", label: "Logo path", kind: "path" },
  { key: "galleryBackdrops", label: "Gallery backdrops (up to 5 paths, comma separated)", kind: "list" },
  { key: "cast", label: "Cast (JSON: name, character, profilePath)", kind: "json" },
];

export const SHOW_DEFS: FieldDef[] = [
  { key: "name", label: "Name", kind: "text" },
  { key: "originalName", label: "Original name", kind: "text" },
  { key: "tagline", label: "Tagline", kind: "text" },
  { key: "overview", label: "Overview", kind: "textarea" },
  { key: "firstAirDate", label: "First air date", kind: "date" },
  { key: "lastAirDate", label: "Last air date", kind: "date" },
  { key: "status", label: "Status", kind: "text" },
  { key: "genres", label: "Genres (comma separated)", kind: "list" },
  { key: "rating", label: "Rating (0-10)", kind: "float" },
  { key: "voteCount", label: "Vote count", kind: "int" },
  { key: "originalLanguage", label: "Original language", kind: "text" },
  { key: "posterPath", label: "Poster path", kind: "path" },
  { key: "backdropPath", label: "Backdrop path", kind: "path" },
  { key: "logoPath", label: "Logo path", kind: "path" },
  { key: "galleryBackdrops", label: "Gallery backdrops (up to 5 paths, comma separated)", kind: "list" },
  { key: "cast", label: "Cast (JSON: name, character, profilePath)", kind: "json" },
];

export const SEASON_DEFS: FieldDef[] = [
  { key: "seasonNumber", label: "Season number", kind: "int" },
  { key: "name", label: "Name", kind: "text" },
  { key: "overview", label: "Overview", kind: "textarea" },
  { key: "airDate", label: "Air date", kind: "date" },
  { key: "posterPath", label: "Poster path", kind: "path" },
];

export const EPISODE_DEFS: FieldDef[] = [
  { key: "episodeNumber", label: "Episode number", kind: "int" },
  { key: "name", label: "Name", kind: "text" },
  { key: "overview", label: "Overview", kind: "textarea" },
  { key: "airDate", label: "Air date", kind: "date" },
  { key: "runtimeMinutes", label: "Runtime (minutes)", kind: "int" },
  { key: "stillPath", label: "Still path", kind: "path" },
];

const IMAGE_KEYS = ["posterPath", "backdropPath", "logoPath", "galleryBackdrops"];
/** Text fields only: the image paths are edited on the Images tab. */
export const withoutImages = (defs: FieldDef[]) => defs.filter((d) => !IMAGE_KEYS.includes(d.key));
export const onlyImages = (defs: FieldDef[]) => defs.filter((d) => IMAGE_KEYS.includes(d.key));
