const Card = ({ landscape = false }: { landscape?: boolean }) => (
  <>
    <div className="v-skel" style={{ aspectRatio: landscape ? "16 / 9" : "2 / 3", borderRadius: "var(--v-radius)" }} />
    <div className="v-skel" style={{ height: ".8rem", width: "70%", marginTop: ".6rem" }} />
    <div className="v-skel" style={{ height: ".7rem", width: "35%", marginTop: ".35rem" }} />
  </>
);

export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <ul className="v-grid" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}><Card /></li>
      ))}
    </ul>
  );
}

export function RowSkeleton({ landscape = false }: { landscape?: boolean }) {
  return (
    <div className="v-row" aria-hidden="true">
      <div className="v-row-head">
        <div className="v-skel" style={{ height: "1.25rem", width: "12rem" }} />
      </div>
      <ul className="v-scroller" data-variant={landscape ? "landscape" : "poster"}>
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i}><Card landscape={landscape} /></li>
        ))}
      </ul>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="v-detail" aria-busy="true" aria-label="Loading">
      <div className="v-detail-head">
        <div className="v-skel v-detail-poster" />
        <div style={{ display: "grid", gap: ".75rem", alignContent: "start" }}>
          <div className="v-skel" style={{ height: "2.25rem", width: "60%" }} />
          <div className="v-skel" style={{ height: "1rem", width: "40%" }} />
          <div className="v-skel" style={{ height: "2.75rem", width: "12rem" }} />
          <div className="v-skel" style={{ height: "4rem", width: "90%" }} />
        </div>
      </div>
    </div>
  );
}

export function LibrarySkeleton() {
  return (
    <>
      <RowSkeleton landscape />
      <RowSkeleton />
      <RowSkeleton />
    </>
  );
}
