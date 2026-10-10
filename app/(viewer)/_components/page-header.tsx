import Link from "next/link";

export type Tab = { href: string; label: string; current: boolean };

/** Plex-style page header: title (+ subtitle) left, link tabs centred, view controls right. */
export function PageHeader({ title, subtitle, tabs, controls, srOnly = false }: { title: string; subtitle?: string; tabs?: Tab[]; controls?: React.ReactNode; srOnly?: boolean }) {
  return (
    <header className="v-ph">
      <div className="v-ph-title">
        <h1 className={srOnly ? "v-sr" : undefined}>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {tabs && tabs.length > 0 && (
        <nav className="v-ph-tabs" aria-label={`${title} views`}>
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} aria-current={t.current ? "page" : undefined} replace>
              {t.label}
            </Link>
          ))}
        </nav>
      )}
      {controls && <div className="v-ph-controls">{controls}</div>}
    </header>
  );
}
