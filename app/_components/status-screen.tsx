import { Noto_Sans } from "next/font/google";
import "./status-screen.css";

const font = Noto_Sans({ subsets: ["latin"], weight: ["400", "700", "800"], display: "swap" });

export type StatusAction = { label: string; href?: string; onClick?: () => void; primary?: boolean };

/** Branded full-screen page for 404s and errors. Plain anchors, so it also works when the app crashed. */
export function StatusScreen({
  code,
  title,
  message,
  reference,
  actions,
}: {
  code: string;
  title: string;
  message: string;
  /** Error digest to quote to support. */
  reference?: string;
  actions: StatusAction[];
}) {
  return (
    <div className={`s-screen ${font.className}`}>
      <main className="s-card">
        <a href="/dashboard" className="s-brand">evolix</a>
        <p className="s-code" aria-hidden="true">{code}</p>
        <h1>{title}</h1>
        <p className="s-text">{message}</p>
        {reference && <p className="s-ref">Reference: {reference}</p>}
        <div className="s-actions">
          {actions.map((a) =>
            a.href ? (
              <a key={a.label} href={a.href} className="s-btn" data-primary={a.primary || undefined}>{a.label}</a>
            ) : (
              <button key={a.label} type="button" className="s-btn" data-primary={a.primary || undefined} onClick={a.onClick}>{a.label}</button>
            ),
          )}
        </div>
      </main>
    </div>
  );
}
