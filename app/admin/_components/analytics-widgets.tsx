import { imageUrl } from "@/lib/images";

const num = (n: number, digits = 0) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** Headline figure with the change against the previous window of the same length. */
export function Kpi({
  label,
  value,
  prev,
  digits = 0,
  suffix = "",
  hint,
}: {
  label: string;
  value: number;
  prev: number;
  digits?: number;
  suffix?: string;
  hint?: string;
}) {
  const delta = prev ? ((value - prev) / prev) * 100 : null;
  const tone =
    delta === null ? "" : delta > 0 ? "an-up" : delta < 0 ? "an-down" : "";
  return (
    <div className="stat an-kpi">
      <span className="an-kpi-label">{label}</span>
      <strong>
        {num(value, digits)}
        {suffix && <small>{suffix}</small>}
      </strong>
      <span className={`an-delta ${tone}`} title={hint}>
        {delta === null
          ? value
            ? "new this period"
            : "no data yet"
          : `${delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} ${num(Math.abs(delta))}% vs previous`}
      </span>
    </div>
  );
}

/** Ranked horizontal bars; `max` defaults to the largest value. */
export function HBars({
  title,
  rows,
  unit = "",
  max,
  note,
}: {
  title: string;
  rows: { label: string; value: number; sub?: string }[];
  unit?: string;
  max?: number;
  note?: string;
}) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 0);
  return (
    <figure className="stat an-card">
      <figcaption>{title}</figcaption>
      {rows.length === 0 ? (
        <p className="an-empty">No data in this period.</p>
      ) : (
        <ul className="an-hbars">
          {rows.map((r) => (
            <li key={r.label}>
              <span className="an-hbar-label" title={r.label}>
                {r.label}
              </span>
              <span className="an-hbar-track">
                <span
                  className="an-hbar-fill"
                  style={{
                    width: `${top ? Math.max((r.value / top) * 100, r.value ? 2 : 0) : 0}%`,
                  }}
                />
              </span>
              <span className="an-hbar-value">
                {num(r.value)}
                {unit}
                {r.sub && <small> {r.sub}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="an-note">{note}</p>}
    </figure>
  );
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Weekday x hour grid (UTC); cell opacity scales with the count. */
export function Heatmap({
  cells,
}: {
  cells: { dow: number; hour: number; n: number }[];
}) {
  const max = Math.max(...cells.map((c) => c.n), 0) || 1;
  const at = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.n]));
  const peak = cells.reduce<(typeof cells)[number] | null>(
    (a, c) => (!a || c.n > a.n ? c : a),
    null,
  );
  return (
    <figure className="stat an-card">
      <figcaption>When people watch</figcaption>
      <div className="an-heat-scroll">
        <div
          className="an-heat"
          role="img"
          aria-label="Plays by weekday and hour, UTC"
        >
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="an-heat-h">
              {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
            </span>
          ))}
          {DOW.map((d, i) => (
            <div key={d} className="an-heat-row">
              <span className="an-heat-d">{d}</span>
              {Array.from({ length: 24 }, (_, h) => {
                const n = at.get(`${i + 1}-${h}`) ?? 0;
                return (
                  <span
                    key={h}
                    className="an-heat-cell"
                    style={{
                      opacity: n ? 0.18 + (n / max) * 0.82 : 1,
                      background: n ? "var(--a-gold)" : undefined,
                    }}
                    title={`${d} ${String(h).padStart(2, "0")}:00 UTC - ${n} plays`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="an-note">
        {peak
          ? `Busiest: ${DOW[peak.dow - 1]} around ${String(peak.hour).padStart(2, "0")}:00 UTC (${peak.n} plays).`
          : "No plays in this period."}{" "}
        Hours are UTC.
      </p>
    </figure>
  );
}

type TopRow = {
  id: string;
  kind: "movie" | "show";
  title: string;
  poster: string | null;
  plays: number;
  viewers: number;
  seconds: number;
  completed: number;
};

export function TopTitles({ rows }: { rows: TopRow[] }) {
  return (
    <figure className="stat an-card">
      <figcaption>Top titles</figcaption>
      {rows.length === 0 ? (
        <p className="an-empty">Nothing watched in this period.</p>
      ) : (
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="an-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Viewers</th>
                <th>Plays</th>
                <th>Hours</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const poster = imageUrl(r.poster, "w92");
                return (
                  <tr key={r.id}>
                    <td className="an-rank">{i + 1}</td>
                    <td>
                      <a
                        href={`/admin/${r.kind === "movie" ? "movies" : "shows"}/${r.id}`}
                        className="an-title"
                      >
                        {poster ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={poster}
                            alt=""
                            width={28}
                            height={42}
                            loading="lazy"
                          />
                        ) : (
                          <span className="an-poster-ph" />
                        )}
                        <span>
                          {r.title}
                          <small>
                            {r.kind === "movie" ? "Movie" : "TV show"}
                          </small>
                        </span>
                      </a>
                    </td>
                    <td>{r.viewers}</td>
                    <td>{r.plays}</td>
                    <td>{num(r.seconds / 3600, 1)}</td>
                    <td>
                      {r.plays
                        ? `${Math.round((r.completed / r.plays) * 100)}%`
                        : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}

/** Conversion steps; each bar shows its share of the first step and the drop from the previous one. */
export function Funnel({
  steps,
}: {
  steps: { label: string; value: number }[];
}) {
  const first = steps[0]?.value || 1;
  return (
    <figure className="stat an-card">
      <figcaption>User funnel</figcaption>
      <ol className="an-funnel">
        {steps.map((s, i) => {
          const prev = i ? steps[i - 1].value : 0;
          return (
            <li key={s.label}>
              <div className="an-funnel-head">
                <span>{s.label}</span>
                <span>
                  <b>{num(s.value)}</b>{" "}
                  <small>{Math.round((s.value / first) * 100)}%</small>
                </span>
              </div>
              <span className="an-hbar-track">
                <span
                  className="an-hbar-fill"
                  style={{ width: `${(s.value / first) * 100}%` }}
                />
              </span>
              {i > 0 && prev > s.value && (
                <small className="an-drop">
                  −{num(prev - s.value)} from previous step
                </small>
              )}
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
