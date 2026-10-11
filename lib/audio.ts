/** Audio (dub) languages a source can be tagged with. Empty = not specified. */
export const AUDIO_LANGUAGES = [
  { code: "si", label: "Sinhala" },
  { code: "en", label: "English" },
  { code: "ta", label: "Tamil" },
  { code: "hi", label: "Hindi" },
] as const;
export const AUDIO_CODES = ["", ...AUDIO_LANGUAGES.map((l) => l.code)] as [string, ...string[]];
/** The language a viewer gets first when a title has several. */
export const DEFAULT_AUDIO = "si";
export const AUDIO_COOKIE = "evolix-audio";

export const audioLabel = (code: string) => AUDIO_LANGUAGES.find((l) => l.code === code)?.label ?? "";

/** Where a title is listed. */
export const AUDIENCES = ["general", "kids", "both"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABEL: Record<Audience, string> = {
  general: "Main app only",
  kids: "Kids section only",
  both: "Main app and Kids",
};
