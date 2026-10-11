import { AUDIO_LANGUAGES, DEFAULT_AUDIO } from "@/lib/audio";

export type AudioChoice<S> = {
  /** Dub languages present on this title, in display order. */
  languages: string[];
  /** The language being played ("" when sources carry no language tags). */
  active: string;
  /** Sources for the active language (untagged sources count for every language). */
  visible: S[];
  selected: S | null;
  /** Set when the viewer's preferred language has no source here and another one is playing. */
  fellBackFrom: string | null;
};

/**
 * Picks the language and source to play. Order of preference: the chosen source's own language,
 * ?lang=, the remembered choice, then Sinhala, then whatever exists.
 */
export function chooseAudio<S extends { id: string; audioLanguage: string }>(
  all: S[],
  { source, lang, saved }: { source?: string; lang?: string; saved?: string },
): AudioChoice<S> {
  const languages = AUDIO_LANGUAGES.map((l) => l.code as string).filter((c) => all.some((s) => s.audioLanguage === c));
  const bySource = all.find((s) => s.id === source);
  const asked = lang || saved || "";
  const want = bySource?.audioLanguage || asked || DEFAULT_AUDIO;
  let active = languages.includes(want) ? want : "";
  if (!active && languages.length) active = languages.includes(DEFAULT_AUDIO) ? DEFAULT_AUDIO : languages[0];
  const visible = languages.length ? all.filter((s) => s.audioLanguage === active || s.audioLanguage === "") : all;
  const selected = visible.find((s) => s.id === source) ?? visible[0] ?? null;
  const fellBackFrom = languages.length && !bySource?.audioLanguage && asked && asked !== active && !languages.includes(asked) ? asked : null;
  return { languages, active, visible, selected, fellBackFrom };
}
