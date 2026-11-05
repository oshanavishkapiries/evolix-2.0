# Friendly errors

Viewers never see raw engine text ("Evo engine returned 503", "All stream extractors failed…"). They see a short title and one plain sentence. The raw text stays in the error tracker (with a reference) and in the admin pages.

One table does this for both server and browser: `lib/evo/problems.ts`.

| Code | When | Viewer sees | Retries |
|---|---|---|---|
| `BUSY` | engine queue is full (503 + `Retry-After`) | "We're very busy right now" | automatic, up to 6 times |
| `ENGINE_UNAVAILABLE` | engine down, restarting, or 502/504 | "Our video service is restarting" | manual |
| `NO_SOURCE` | extraction found nothing playable | "No playable copy yet" | manual |
| `RATE_LIMITED` | per-viewer limit | "Too many tries" | manual |
| `SUBTITLES` | provider could not supply a subtitle | "Subtitles aren't ready" (video unaffected) | manual |
| `OFFLINE` | the request never left the browser | "You're offline" / "Can't reach our servers" | automatic when the connection returns |
| `UNKNOWN` | anything else | "Something went wrong on our side" + reference | manual |

## How it flows

```
 engine says 503 (queue full) ──► startIngest ──► BUSY + Retry-After ──► /api/evo/ingest
                                                                            │  (viewer allowance is given back)
                                                                            ▼
                                   player: calm "busy" scene, countdown, retry (a bit slower each time, jittered)
                                   after 6 retries: "still very busy", Try again button
```

- A failed task: `/api/evo/status/<id>` replaces the engine's message with the friendly one and adds `code`. Progress messages of running tasks pass through unchanged.
- `UNKNOWN` is sent to the error tracker at warning level with a short `ref` tag; the same `ref` is shown to the viewer.
- Admins keep the raw reason: `startIngest` returns it as `detail` (stripped by the viewer route only).

## Engine behavior behind it

- A new request refused because the queue is full is deleted, so busy answers no longer leave a FAILED task row each.
- A request that joins a task already waiting is not refused or failed: that task keeps its place.

## Adding a problem

1. Add the code and wording to `PROBLEMS` in `lib/evo/problems.ts` (no HTTP codes or provider names in the text; a test checks this).
2. Map the engine text in `classifyFailure`, or return `problemBody(code)` from the route.
3. The browser (`lib/client/problem.ts`) needs no change.

Tests: `pnpm test:problems` (mapping and routes), `pnpm test:subtitles:e2e` (busy scene, countdown, offline), `pnpm test:subtitles:engine` (busy refusal).
