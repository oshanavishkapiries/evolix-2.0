# Viewer journeys

The Evo admin page used to list every engine task and count every step of every attempt. One title that failed three times and then worked looked like "3 failures and 1 success". Journeys answer the question that matters: **did the viewer finally get to watch, and how hard was it?**

## What a journey is
All engine tasks for the same title (movie, or season + episode), split into video and Sinhala subtitles, in the chosen window (24 hours or 7 days). A retry makes a new task; the journey keeps them together, even when the retry ran on another engine.

## Outcomes
| Outcome | Rule |
|---|---|
| Watched smoothly | a try became watchable (stream ready or a CDN file), it was the first try, and it took 60 seconds or less from the first request |
| Watched after trouble | it became watchable in the end, but after failed tries or a longer wait |
| Never got it | no try became watchable and the latest try is not running: the viewer is stuck or gave up |
| Still trying | the latest try is still running |

The first try that became watchable decides the outcome. Later tries (for example another quality that failed) do not change it. A stream that plays while caching it for later failed still counts as watched.

## The pipeline graph
Each journey counts once, by the try that decided it. A step is red when viewers got stuck there for good, yellow ("recovered") when an earlier try failed there but the viewer still got through, and red wins over "running". The engine detail page still shows the old per-attempt counts, which is the right view for debugging one engine.

## Where it is computed
- Engine: `GET /api/v1/media/pipeline/journeys?hours=24|168` (`SQLiteTaskRepository.journeys`). It groups the window's tasks and reports facts only: which try was watchable, when it became ready, which step each failed try died at.
- App: `lib/evo/journeys.ts` merges the engines' journeys (a try that failed on engine A and worked on engine B is one journey) and decides the outcome. `lib/evo/overview.ts` (`journeyReport`) fetches; `GET /api/admin/evo/journeys` serves the panel.
- UI: `app/admin/_components/journeys-panel.tsx`.

## Limits
- It counts engine tasks, not individual viewers. A cached title watched by fifty people is one smooth journey. "Actually pressed play and watched" would need player events; this measures whether the viewer could watch.
- A viewer who joins a task already running does not make a new task, so tries are the engine's attempts.
- The window is by task creation time. A journey that began before the window shows only its tries inside it.
- Engines that have not been updated cannot report journeys; the panel says so and the raw task table stays available.

Tests: `pnpm test:journeys` (verdict and merge logic), `pnpm test:subtitles:engine` (engine grouping), `pnpm test:subtitles:e2e` (the panel).
