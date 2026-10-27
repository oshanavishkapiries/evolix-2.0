export type Series = { key: string; label: string; color: string; values: number[] };

const W = 480;
const H = 200;
const M = { l: 44, r: 8, t: 8, b: 22 };

/** Round `max` up to a tick step of 1, 2 or 5 x 10^n so the axis reads cleanly. */
function niceTicks(max: number, count = 4) {
  if (max <= 0) return { step: 1, top: count, ticks: Array.from({ length: count + 1 }, (_, i) => i) };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const top = Math.ceil(max / step) * step;
  return { step, top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** Dependency-free stacked bar/area chart with y-axis, gridlines and a legend; the newest day is on the right. */
export function StackChart({
  title,
  days,
  series,
  type = "bar",
  format = compact,
  total,
}: {
  title: string;
  days: string[];
  series: Series[];
  type?: "bar" | "area";
  /** Axis and tooltip number formatter. */
  format?: (n: number) => string;
  /** Headline figure; defaults to nothing. */
  total?: string;
}) {
  const n = days.length;
  const sums = days.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const { top, ticks } = niceTicks(Math.max(...sums, 0));
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const x = (i: number) => M.l + (type === "area" ? (n > 1 ? (i / (n - 1)) * pw : pw / 2) : ((i + 0.5) / n) * pw);
  const y = (v: number) => M.t + ph - (v / top) * ph;
  const bw = Math.min(26, (pw / n) * 0.7);
  const every = Math.ceil(n / 8);

  // Cumulative baseline per day, bottom series first.
  const base = days.map(() => 0);
  const layers = series.map((s) => {
    const lo = [...base];
    s.values.forEach((v, i) => (base[i] += v ?? 0));
    return { s, lo, hi: [...base] };
  });

  return (
    <figure className="stat" style={{ margin: 0 }}>
      <figcaption className="text-base font-semibold">{title}</figcaption>
      {total && <strong>{total}</strong>}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title}, last ${n} days`} style={{ marginTop: 8, display: "block" }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="#3a3a3a" strokeDasharray="3 4" />
            <text x={M.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#9a9a9a">
              {format(t)}
            </text>
          </g>
        ))}
        {days.map(
          (d, i) =>
            i % every === 0 && (
              <text key={d} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#9a9a9a">
                {d.slice(5)}
              </text>
            ),
        )}
        {layers.map(({ s, lo, hi }) =>
          type === "area" ? (
            <path
              key={s.key}
              fill={s.color}
              fillOpacity={0.35}
              stroke={s.color}
              strokeWidth={1.5}
              d={`M${days.map((_, i) => `${x(i)},${y(hi[i])}`).join(" L")} L${[...days.keys()].reverse().map((i) => `${x(i)},${y(lo[i])}`).join(" L")} Z`}
            />
          ) : (
            days.map((d, i) =>
              hi[i] > lo[i] ? (
                <rect key={`${s.key}${d}`} x={x(i) - bw / 2} y={y(hi[i])} width={bw} height={y(lo[i]) - y(hi[i])} fill={s.color}>
                  <title>{`${d} - ${s.label}: ${format(s.values[i])}`}</title>
                </rect>
              ) : null,
            )
          ),
        )}
        {type === "area" &&
          days.map((d, i) => (
            <rect key={d} x={x(i) - pw / n / 2} y={M.t} width={pw / n} height={ph} fill="transparent">
              <title>{`${d}: ${series.map((s) => `${s.label} ${format(s.values[i])}`).join(", ")}`}</title>
            </rect>
          ))}
      </svg>
      {series.length > 1 || series[0]?.label ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {series.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}
