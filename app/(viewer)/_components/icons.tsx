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
export const BookmarkIcon = ({ size = 20, className, filled = false }: P & { filled?: boolean }) => (
  <svg {...base(size)} className={className} {...stroke} fill={filled ? "currentColor" : "none"}><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /></svg>
);
export const ListIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} {...stroke}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
);
export const MenuIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className} {...stroke}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
);
export const GridIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor"><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="9.5" y="3" width="5" height="5" rx="1" /><rect x="16" y="3" width="5" height="5" rx="1" /><rect x="3" y="9.5" width="5" height="5" rx="1" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><rect x="16" y="9.5" width="5" height="5" rx="1" /><rect x="3" y="16" width="5" height="5" rx="1" /><rect x="9.5" y="16" width="5" height="5" rx="1" /><rect x="16" y="16" width="5" height="5" rx="1" /></svg>
);
export const RowsIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} {...stroke}><rect x="3" y="4" width="18" height="6" rx="1" /><rect x="3" y="14" width="18" height="6" rx="1" /></svg>
);
export const ShareIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} {...stroke}><path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg>
);
export const FilmPlayIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} {...stroke}><circle cx="12" cy="12" r="9" /><path d="m10 8.5 5.5 3.5-5.5 3.5z" /></svg>
);
export const UserIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className} {...stroke}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
);
