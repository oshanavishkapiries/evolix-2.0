/** Viewer's subtitle look, kept in localStorage and applied to the player as CSS variables. */
export type SubStyle = {
  /** Percent of the default cue size. */
  size: number;
  font: keyof typeof FONTS;
  bold: boolean;
  color: string;
  edge: keyof typeof EDGES;
  bg: string;
  /** Background opacity, 0-100. */
  bgOpacity: number;
  /** How far to lift lines above the bottom, percent of the video height. */
  lift: number;
};

export const FONTS = {
  default: { label: "Default", css: "inherit" },
  sans: { label: "Sans", css: '"Helvetica Neue", Arial, sans-serif' },
  serif: { label: "Serif", css: 'Georgia, "Times New Roman", serif' },
  mono: { label: "Mono", css: 'ui-monospace, "Cascadia Mono", "Courier New", monospace' },
  casual: { label: "Casual", css: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive' },
} as const;

/** Edge effects; `$` is replaced with a colour contrasting the text. */
export const EDGES = {
  shadow: { label: "Shadow", css: "0 0 4px $, 1px 1px 2px $" },
  outline: { label: "Outline", css: "-.06em -.06em 0 $, .06em -.06em 0 $, -.06em .06em 0 $, .06em .06em 0 $, 0 0 .15em $" },
  raised: { label: "Raised", css: ".04em .04em 0 $, .08em .08em 0 $" },
  none: { label: "None", css: "none" },
} as const;

export const TEXT_COLORS = ["#ffffff", "#ffe14d", "#4de1ff", "#5df58a", "#ff8ad8", "#000000"];
export const BG_COLORS = ["#000000", "#1f2937", "#ffffff", "#0b3d91"];
export const SIZE_RANGE = { min: 50, max: 200, step: 10 };
export const LIFT_MAX = 40;

// Matches the original skin: white text with a soft shadow, no box.
export const DEFAULT_STYLE: SubStyle = { size: 100, font: "default", bold: false, color: "#ffffff", edge: "shadow", bg: "#000000", bgOpacity: 0, lift: 0 };

const KEY = "v-sub-style";
const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (n: unknown, min: number, max: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d);

export function loadStyle(): SubStyle {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v || typeof v !== "object") return DEFAULT_STYLE;
    const d = DEFAULT_STYLE;
    return {
      size: clamp(v.size, SIZE_RANGE.min, SIZE_RANGE.max, d.size),
      font: v.font in FONTS ? v.font : d.font,
      bold: typeof v.bold === "boolean" ? v.bold : d.bold,
      color: HEX.test(v.color) ? v.color : d.color,
      edge: v.edge in EDGES ? v.edge : d.edge,
      bg: HEX.test(v.bg) ? v.bg : d.bg,
      bgOpacity: clamp(v.bgOpacity, 0, 100, d.bgOpacity),
      lift: clamp(v.lift, 0, LIFT_MAX, d.lift),
    };
  } catch {
    return DEFAULT_STYLE;
  }
}

export function saveStyle(s: SubStyle) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const isLight = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
};

/** CSS variables read by the `.vds-captions` rules in components.css. */
export function styleVars(s: SubStyle): Record<`--${string}`, string | number> {
  const edgeColor = isLight(s.color) ? "#000" : "#fff";
  return {
    "--sub-scale": s.size / 100,
    "--sub-font": FONTS[s.font].css,
    "--sub-weight": s.bold ? 700 : "inherit",
    "--sub-color": s.color,
    "--sub-edge": EDGES[s.edge].css.replaceAll("$", edgeColor),
    "--sub-bg": `rgb(${rgb(s.bg).join(" ")} / ${s.bgOpacity / 100})`,
    "--sub-lift": `${s.lift}%`,
  };
}
