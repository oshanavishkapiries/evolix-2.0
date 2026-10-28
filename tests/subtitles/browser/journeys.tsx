import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JourneysPanel } from '@/app/admin/_components/journeys-panel';
import type { JourneyReport } from '@/lib/evo/journeys';
import '@/app/admin/admin.css';

/** The admin page server-renders the first report; here the test's mocked API plays that part. */
function App() {
  const [initial, setInitial] = useState<JourneyReport | null | undefined>(undefined);
  useEffect(() => { fetch('/api/admin/evo/journeys?hours=24').then((r) => r.json()).then((b) => setInitial(b.report)); }, []);
  return <div className="adm" style={{ padding: 16 }}>{initial === undefined ? null : <JourneysPanel initial={initial} multi />}</div>;
}
createRoot(document.getElementById('root')!).render(<App />);
