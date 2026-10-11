/** "Details" panel: label/value pairs, empty values dropped. */
export function DetailFacts({ facts }: { facts: [string, string][] }) {
  const rows = facts.filter(([, v]) => v);
  if (!rows.length) return null;
  return (
    <section className="v-row v-facts" aria-label="Details">
      <div className="v-row-head"><div className="v-row-title"><h2>Details</h2></div></div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
