export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="v-grid" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="v-skel" style={{ aspectRatio: "2 / 3" }} />
      ))}
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="v-row" aria-hidden="true">
      <div className="v-row-head">
        <div className="v-skel" style={{ height: "1.5rem", width: "12rem" }} />
      </div>
      <ul className="v-scroller">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i}>
            <div className="v-skel" style={{ aspectRatio: "2 / 3" }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HeroSkeleton({ slim = false }: { slim?: boolean }) {
  return <div className={`v-hero v-skel${slim ? " v-hero-slim" : ""}`} style={{ borderRadius: 0 }} aria-busy="true" aria-label="Loading" />;
}

export function LibrarySkeleton() {
  return (
    <>
      <HeroSkeleton />
      <RowSkeleton />
      <RowSkeleton />
    </>
  );
}
