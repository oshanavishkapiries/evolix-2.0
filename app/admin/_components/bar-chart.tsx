type Bar = { label: string; value: number };

/** Dependency-free SVG bar chart; the newest day is on the right. */
export function BarChart({ title, bars, unit = "", digits = 0 }: { title: string; bars: Bar[]; unit?: string; digits?: number }) {
  const max = Math.max(...bars.map((b) => b.value), 0) || 1;
  const total = bars.reduce((a, b) => a + b.value, 0);
  const W = 100 / bars.length;
  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (
    <figure className="stat" style={{ margin: 0 }}>
      <figcaption className="text-base font-semibold">{title}</figcaption>
      <strong>{unit === "$" ? "$" : ""}{fmt(total)}{unit && unit !== "$" ? ` ${unit}` : ""}</strong>
      <small>last {bars.length} days</small>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="120" role="img" aria-label={`${title}, last ${bars.length} days`} style={{ marginTop: 8 }}>
        {bars.map((b, i) => {
          const h = (b.value / max) * 36;
          return (
            <rect key={b.label} x={i * W + W * 0.15} y={40 - h} width={W * 0.7} height={Math.max(h, b.value > 0 ? 0.6 : 0)} rx={0.6} fill="currentColor" style={{ color: "var(--color-indigo-500)" }}>
              <title>{`${b.label}: ${unit === "$" ? "$" : ""}${fmt(b.value)}${unit && unit !== "$" ? ` ${unit}` : ""}`}</title>
            </rect>
          );
        })}
      </svg>
      <small style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{bars[0]?.label.slice(5)}</span>
        <span>{bars.at(-1)?.label.slice(5)}</span>
      </small>
    </figure>
  );
}
