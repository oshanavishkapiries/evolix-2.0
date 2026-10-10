/** Placeholder while a sub-page loads (also used for the header while the shell loads). */
export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-16" />
      ))}
    </div>
  );
}

export function HeaderSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-4 w-40" />
      <div className="flex gap-3">
        <div className="skeleton h-[72px] w-12" />
        <div className="skeleton h-12 flex-1" />
      </div>
      <div className="skeleton h-9" />
    </div>
  );
}
