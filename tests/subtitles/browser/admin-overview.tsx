import { createRoot } from 'react-dom/client';
import { OverviewView } from '@/app/admin/_components/overview-view';
import '@/app/admin/admin.css';

const day = (i: number) => new Date(Date.UTC(2026, 9, 16 + i)).toISOString().slice(0, 10);
const plays = [3, 5, 2, 4, 1, 3, 6, 4, 8, 7, 12, 20, 60, 38];
const days = plays.map((p, i) => ({ day: day(i), plays: p, viewers: Math.ceil(p / 2), signups: i > 10 ? [4, 70, 3][i - 11] : i % 3, hours: p * 0.35, gb: p * 0.5, cost: p * 0.005 }));
const title = (id: string, name: string, year: string) => ({ id, tmdbId: 1, title: name, name, releaseDate: `${year}-01-01`, firstAirDate: `${year}-01-01`, posterPath: null, isPublished: true });
const params = new URLSearchParams(location.search);

createRoot(document.getElementById('root')!).render(
  <div className="adm"><main className="adm-main">
    <div className="page-header"><h1>Overview</h1></div>
    <OverviewView
      o={{ movies: { total: 67, published: 67 }, shows: { total: 69, published: 68 }, reports: { open: Number(params.get('reports') ?? 2), new24: 1 }, recentMovies: [title('m1', 'Drawn Together', '2026'), title('m2', 'Harry Potter and the Philosopher’s Stone', '2001')], recentShows: [title('s1', 'Legacies', '2018'), title('s2', 'The Crown', '2016')] }}
      days={days}
      errs={{ open: 9, new24: 0, events24: 28 }}
      engines={[{ healthy: true, activeJobs: 1, queueDepth: 2 }, { healthy: params.get('down') !== '1', activeJobs: 0, queueDepth: 0 }]}
      rates={{ gbPerHour: 1.5, costPerGb: 0.01 }}
    />
  </main></div>,
);
