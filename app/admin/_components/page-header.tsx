/** Page title with an optional actions area (right-aligned, wraps on small screens). */
export function PageHeader({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {actions && <div className="toolbar">{actions}</div>}
    </div>
  );
}
