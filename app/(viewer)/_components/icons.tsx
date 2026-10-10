type P = { size?: number; className?: string };
const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true as const, focusable: false as const });
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const PlayIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" /></svg>
);
export const InfoIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} {...stroke}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
);
export const HomeIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} {...stroke}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
);
export const FilmIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} {...stroke}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4M3 12h18M3 16h4M17 8h4M17 16h4" /></svg>
);
export const TvIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} {...stroke}><rect x="2" y="7" width="20" height="15" rx="2" /><path d="m17 2-5 5-5-5" /></svg>
);
export const SearchIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} {...stroke}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
);
export const ChevronIcon = ({ size = 20, className, dir = "down" }: P & { dir?: "left" | "right" | "down" }) => (
  <svg {...base(size)} className={className} {...stroke} style={{ rotate: dir === "left" ? "90deg" : dir === "right" ? "-90deg" : undefined }}><path d="m6 9 6 6 6-6" /></svg>
);
export const BackIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} {...stroke}><path d="m12 19-7-7 7-7M19 12H5" /></svg>
);
export const StarIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>
);
export const ClockIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} {...stroke}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
);
