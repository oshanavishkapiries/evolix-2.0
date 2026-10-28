import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AttentionList, EngineCards, StatusPill } from '@/app/admin/_components/evo-overview';
import { EngineActions, EngineSettings, QueueStats } from '@/app/admin/_components/evo-controls';
import { MetricsPanel, ProvidersPanel } from '@/app/admin/_components/engine-panels';
import { JourneysPanel } from '@/app/admin/_components/journeys-panel';
import { SummaryFlow } from '@/app/admin/_components/pipeline-graph';
import { ConfirmProvider } from '@/app/admin/_components/confirm-dialog';
import { ToastProvider } from '@/app/admin/_components/toast';
import { attentionItems, healthLine, type EngineCard } from '@/lib/evo/admin-view';
import type { JourneyReport } from '@/lib/evo/journeys';
import '@/app/admin/admin.css';

/** The Evo admin pages' client parts, put together the way the server pages do it, for screenshots (data from the test's mocked API). */
function Overview() {
  const [data, setData] = useState<{ cards: EngineCard[]; report: JourneyReport } | null>(null);
  useEffect(() => { fetch('/api/admin/evo/journeys?hours=24').then((r) => r.json()).then((b) => setData({ cards: b.cards, report: b.report })); }, []);
  if (!data) return null;
  const health = healthLine(data.cards);
  const items = attentionItems(data.cards, [{ id: 'j', title: 'Jailer 2', detail: 'Extract streams: No streams found for media', href: '#' }]);
  return (
    <>
      <div className="page-header"><h1>Evo pipeline</h1></div>
      <div className="evo-stack">
        <div className="health" data-tone={health.level}>
          <StatusPill tone={health.level} text={health.text} />
          <ul><li><strong>2/2</strong> engines up</li><li><strong>1</strong> extracting</li><li><strong>0</strong> caching</li><li><strong>3</strong> waiting</li><li><strong>3/4</strong> providers healthy</li></ul>
        </div>
        <section className="evo-section"><div className="evo-section-head"><h2>Needs attention <span className="evo-count" data-tone="bad">{items.length}</span></h2></div><AttentionList items={items} /></section>
        <section className="evo-section"><div className="evo-section-head"><h2>Engines</h2></div><EngineCards engines={data.cards} /></section>
        <JourneysPanel initial={data.report} multi />
        <section className="evo-section">
          <div className="evo-section-head"><div><h2>Raw data</h2><p className="evo-sub">For digging in. Most days the sections above are enough.</p></div></div>
          <details className="evo-details"><summary>Engine tasks <span className="evo-count">40</span><span className="evo-muted"> · one row per try, newest first</span></summary></details>
          <details className="evo-details"><summary>Cached sources <span className="evo-count">40</span><span className="evo-muted"> · newest videos on the CDN</span></summary></details>
        </section>
      </div>
    </>
  );
}

function Engine() {
  const tab = new URLSearchParams(location.search).get('tab') ?? 'status';
  return (
    <>
      <div className="page-header engine-head">
        <div>
          <h1>oshan <StatusPill tone="ok" text="Available" /></h1>
          <p className="engine-sub"><span>38.242.251.70</span><button type="button" className="btn-link-plain">Copy URL</button></p>
        </div>
        <div className="toolbar"><EngineActions engine="a"><button type="button" className="btn-secondary rounded-md border px-3 py-1.5 text-sm">Drain</button></EngineActions></div>
      </div>
      <nav aria-label="Engine sections" className="tabs"><ul>{['status', 'tasks', 'settings'].map((t) => <li key={t}><a href={`?view=engine&tab=${t}`} className="tab" aria-current={t === tab ? 'page' : undefined}>{t[0].toUpperCase() + t.slice(1)}{t === 'tasks' && <span className="evo-count">12</span>}</a></li>)}</ul></nav>
      {tab === 'settings' ? (
        <div className="mt-4"><p className="evo-note">Applies to the next job, no restart. Each engine has its own settings.</p><EngineSettings engine="a" /></div>
      ) : (
        <div className="evo-stack mt-4">
          <section className="evo-section"><div className="evo-section-head"><h2>Right now</h2><span className="evo-muted">last good check 29 Oct 2026, 00:47</span></div><QueueStats engine="a" />
            <dl className="stat-row mt-3"><div><dt>Free disk</dt><dd>106 GB</dd></div><div><dt>Failed (last 100 tasks)</dt><dd>2</dd></div></dl></section>
          <section className="evo-section"><div className="evo-section-head"><div><h2>Stream providers</h2><p className="evo-sub">A provider that keeps failing is skipped for a while (cool-down). Reset puts it back now.</p></div></div><ProvidersPanel engine="a" /></section>
          <section className="evo-section"><div className="evo-section-head"><div><h2>Extraction cost</h2><p className="evo-sub">Last 24 hours, median / p95 per provider.</p></div></div><MetricsPanel engine="a" /></section>
          <section className="evo-section"><div className="evo-section-head"><div><h2>Pipeline</h2><p className="evo-sub">Every try on this engine, by step. Live.</p></div></div>
            <SummaryFlow engine="a" initial={{ window_hours: 24, tasks_in_flight: 1, steps: { request: { ok: 12, failed: 0, running: 1, skipped: 0 }, extract: { ok: 10, failed: 2, running: 1, skipped: 0 }, resolve: { ok: 10, failed: 0, running: 0, skipped: 0 }, subtitles: { ok: 9, failed: 0, running: 0, skipped: 1 }, stream: { ok: 10, failed: 0, running: 0, skipped: 0 }, cdn_check: { ok: 10, failed: 0, running: 0, skipped: 0 }, download: { ok: 6, failed: 0, running: 0, skipped: 4 }, verify: { ok: 6, failed: 0, running: 0, skipped: 0 }, upload: { ok: 6, failed: 0, running: 0, skipped: 0 }, subtitle_sync: { ok: 5, failed: 1, running: 0, skipped: 0 }, webhook: { ok: 10, failed: 0, running: 0, skipped: 0 }, translate: { ok: 2, failed: 0, running: 0, skipped: 8 } } }} /></section>
        </div>
      )}
    </>
  );
}

const view = new URLSearchParams(location.search).get('view');
createRoot(document.getElementById('root')!).render(
  <div className="adm"><main className="adm-main"><ToastProvider><ConfirmProvider>{view === 'engine' ? <Engine /> : <Overview />}</ConfirmProvider></ToastProvider></main></div>,
);
