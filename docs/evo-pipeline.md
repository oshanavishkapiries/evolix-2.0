# Evo pipeline

The catalog is TMDB-driven. A title becomes playable the first time someone plays it; the engine then caches it to the CDN so later plays never touch the upstream provider.

## Flow

1. Viewer opens `/watch/movie/tmdb-N` (or an episode). Signed in: `ensureMovie` / `ensureEpisode` (`lib/evo/ensure.ts`) create the catalog row (published, no sources), so progress, bookmarks and reports have a UUID to attach to.
2. No source yet -> `EvoPlayer` calls `POST /api/evo/ingest` (session required, rate limited, TMDB-validated). The engine extracts streams and flips to `STREAMING`: playback starts through the signed HLS proxy.
3. In the background the engine downloads the chosen quality (`-movflags +faststart`), verifies size/duration, uploads to Pixeldrain, uploads the subtitle tracks, then reports `POST /api/evo/complete` (secret-protected, retried). `/api/evo/status` also reconciles a finished task if the webhook was lost.
4. `promote()` (`lib/evo/promote.ts`) upserts one `sources` row per quality (`audio_language = 'en'`, 720p sorted first) and one `subtitles` row per language, then expires the catalog cache tag.
5. From then on the title plays straight from the CDN. Missing qualities can be requested from the Sources panel ("Get 1080p"); a CDN file that disappears is deactivated by `/api/evo/heal` and the title falls back to another quality or a fresh ingest.

## Player experience

- Streams start on **720p and stay there**: no adaptive switching and no "switching" toast. The viewer changes quality from the settings menu (cached files list 1080p/720p/480p; an uncached one shows a "Preparing" scene, then continues from the same position).
- A banner ("Now streaming in 720p") slides in when playback starts. After 20s of playback the **quality advisor** may suggest one change: up to 1080p when the measured throughput is far above what 1080p needs, or down one step after repeated stalls. It is only ever a suggestion (OK switches; closing it stores "never ask again" in `localStorage`).
- Every pre-playback state (connecting, preparing, errors) is one shared component (`player-status.tsx`); banners are `player-banner.tsx`. Both use the viewer design tokens.

## Kids section

Kids is TMDB-driven like the main catalog: movies are TMDB discover with US certification G/PG plus Family or Animation; shows use TMDB's own "Kids" genre (its Family/Animation tags also cover adult sitcoms). Search is restricted to the same genres. Titles entering the DB through Evo get an audience from genres plus their US age rating (`lib/evo/audience.ts`), which is what puts them in the Kids My List / Continue Watching. Featured cards show TMDB title logos.

## Sinhala subtitles

Sinhala is translated **on demand**, the first time a viewer picks it, not by the ingest pipeline (titles nobody watches in Sinhala cost nothing). The English track is translated to casual spoken Sinhala through OpenRouter (`TRANSLATE_MODEL`, default `google/gemini-3.1-flash-lite`).

- **Player**: the subtitle menu lists "Sinhala (AI)" whenever the title has an English subtitle. If a `si` row exists it is a normal track (default-selected, no API call). If not, picking it calls `POST /api/evo/translate` and playback carries on with English; a banner ("Preparing Sinhala subtitles…", chunk progress, Retry on error, dismissable) shows while `GET /api/evo/translate` is polled every 3 s. When the track is ready it is loaded and selected. No English subtitle: the option is hidden and the subtitle panel says why.
- **App route** (`app/api/evo/translate`): signed-in only, rate limited (6 starts / 10 min per account), keyed by `tmdbId` + `mediaType` + `season`/`episode`; no engine task id is needed. It answers from the DB when the `si` row exists, otherwise forwards title, IMDb id, synopsis and characters to the engine. A finished job is registered by the poll as well, so a lost webhook cannot lose the track.
- **Engine** (`POST/GET /api/v1/media/subtitles/si`): one job per title/episode, stored as a task with `requested_quality = "sub:si"` so it shows in `/admin/evo` with its own flow (extract…upload `skipped`, then `subtitles`, `translate` with chunk progress, `subtitle_sync`, `webhook`). Concurrent requests join the running job (and the per-subtitle lock keeps even an admin re-run from translating twice); a failed job is retried by the next request; a finished job whose CDN file has vanished is redone. The result is uploaded to Pixeldrain and reported through the usual completion webhook as a subtitles-only payload (no `quality`/`resultUrl`), which `promote()` registers as the `si` row.
- **Pipeline**: ingest no longer translates; its `translate` node reads `skipped (on demand)`.
- States returned to the player: `running`, `done`, `failed`, `unavailable` (daily cap reached, or no `OPENROUTER_API_KEY`).

- A tiny glossary call fixes Sinhala name spellings (from TMDB character names + synopsis, sent by `/api/evo/ingest`) so parallel chunks stay consistent.
- One translation per title/episode (the cached file is keyed by the English subtitle id); other qualities reuse it.
- Spend is ledgered (`api_usage`) and capped per UTC day by `TRANSLATE_DAILY_BUDGET_USD` (default `0` = unlimited for now; set a positive value to re-enable the cap). Typical cost: about $0.07 for a 1,100-cue film, $0.12 for a 2,400-cue one.
- Backfill / re-run: `/admin/evo/<taskId>` has a "Translate subtitles to Sinhala" button (engine `POST /tasks/{id}/translate`, always re-translates).
- Needs `OPENROUTER_API_KEY` in `.env`; without it the node shows "skipped".

## Admin control

- **Job queue**: ingest jobs run on two small worker pools (extract, CDN cache). Waiting jobs sit in a queue, not on request threads; `MAX_QUEUED_TASKS` beyond which `/ingest` answers 503 + `Retry-After`. The HLS proxy is async.
- **`/admin/evo/settings`** (engine `GET/PUT /config`, `DELETE /config/{key}`): live-editable concurrency, queue limit, disk floor, translation budget (0 = unlimited). Stored in the engine's SQLite (`runtime_config`), loaded at startup, applied without restart. Queue pause/resume (`POST /queue/pause|resume`).
- **Task actions** on `/admin/evo`: cancel (before the next stage), retry (fresh job, same title/quality), remove.
- **`/admin/evo/cdn`**: files in the Pixeldrain account (needs `PIXELDRAIN_API_KEY`), delete any file; deleting a cached source's file (`POST /api/admin/evo/cdn/delete`) also removes the catalog row and resets the engine task so the next play re-caches.

## Invariants

- `sources` is unique per `(movie_id | episode_id, quality)`; `subtitles` per `(parent, language)`. Promotion is idempotent.
- A title shows in browse/Kids listings only when it has an active source; rows without one are identity anchors.
- Engine -> app calls need `EVO_SECRET_TOKEN`; app -> engine calls send it as `X-Evo-Secret`. Segment/variant URLs are HMAC-signed, so the engine never fetches a URL it did not hand out.

## Engine settings (`tools/evo-engine`, read from `.env`)

`EVO_WEBHOOK_URL`, `MAX_CONCURRENT_EXTRACTIONS`, `MAX_CONCURRENT_DOWNLOADS`, `MIN_FREE_DISK_GB`, `CLEAN_ORPHANS_ON_START`, `CORS_ORIGINS`.

## Watching it run (admin)

`/admin/evo` shows engine health, a live **pipeline graph** (per-step outcome counts for the last 24h, refreshed every 5s), recent tasks and cached sources. Click a task for its own graph (`/admin/evo/<taskId>`): an n8n-style node view where each step lights up as it runs (running = pulsing gold with a live timer, ok = green, failed = red, skipped = grey, pending = dashed). Click a node for its event log. The page polls every 2s until the task settles.

The engine records one event per step transition (`task_events` in its SQLite; steps listed in `app/domain/models.py::STEPS`, mirrored in `lib/evo/flow.ts`). Endpoints: `GET /api/v1/media/tasks/{id}/events`, `GET /api/v1/media/pipeline/summary`. When adding a pipeline step, add it to both lists and emit events from `IngestService`.

## Tests

- Engine (stdlib `unittest`, fakes for the extractor, CDN, subtitles and model; no network, no spend): from `tools/evo-engine`, `test/.venv/bin/python -m unittest discover -s tests -t .`. Covers the on-demand Sinhala job (dedup, budget cap, retry, subtitles-only webhook, HTTP validation) and that ingest no longer translates.
- Player (Playwright, all `/api/evo/*` calls and the CDN mocked): `pnpm build && pnpm start`, then `tests/e2e/run.sh`. It mints a throwaway session and removes it (and the source-less catalog row for TMDB 680) afterwards.
