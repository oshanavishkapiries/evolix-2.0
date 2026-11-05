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

## Sinhala subtitles

Sinhala is translated **on demand**, the first time a viewer picks it, not by the ingest pipeline (titles nobody watches in Sinhala cost nothing). The English track is translated to casual spoken Sinhala through OpenRouter (`TRANSLATE_MODEL`, default `google/gemini-3.1-flash-lite`).

- **Player**: the subtitle menu lists "Sinhala (AI)" whenever the title has an English subtitle. If a `si` row exists it is a normal track (default-selected, no API call). If not, picking it calls `POST /api/evo/translate` and playback carries on with English; a banner ("Preparing Sinhala subtitles…", chunk progress, Retry on error, dismissable) shows while `GET /api/evo/translate` is polled every 3 s. When the track is ready it is loaded and selected. No English subtitle: the option is hidden and the subtitle panel says why.
- **App route** (`app/api/evo/translate`): signed-in only, rate limited (6 starts / 10 min per account), keyed by `tmdbId` + `mediaType` + `season`/`episode`; no engine task id is needed. It answers from the DB when the `si` row exists, otherwise forwards title, IMDb id, synopsis and characters to the engine. A finished job is registered by the poll as well, so a lost webhook cannot lose the track.
- **Engine** (`POST/GET /api/v1/media/subtitles/si`): one job per title/episode, stored as a task with `requested_quality = "sub:si"` so it shows in `/admin/evo` with its own flow (extract…upload `skipped`, then `subtitles`, `translate` with chunk progress, `subtitle_sync`, `webhook`). Concurrent requests join the running job (and the per-subtitle lock keeps even an admin re-run from translating twice); a failed job is retried by the next request; a finished job whose CDN file has vanished is redone. The result is uploaded to Pixeldrain and reported through the usual completion webhook as a subtitles-only payload (no `quality`/`resultUrl`), which `promote()` registers as the `si` row.
- **Pipeline**: ingest no longer translates; its `translate` node reads `skipped (on demand)`.
- States returned to the player: `running`, `done`, `failed`, `unavailable` (daily cap reached, or no `OPENROUTER_API_KEY`).

- **Cleanup before translation** (`evo-engine/app/services/subtitle_cleaner.py`): text between `{ }`, `( )`, `[ ]`, `* … *` and `# … #` is removed from each cue before anything is sent to OpenRouter (nesting and line breaks inside a span included). A cue left with no words is skipped, so it is not in the Sinhala track either. Unpaired marks stay (`:)`, `1)`), as do `5 * 3 * 2` and `#1`. A span that opens in one cue and closes in the next is not handled. The English track is not changed, and the task event shows `N cue(s) had annotations removed`. Translations cached before this change keep their old text until "clear Sinhala cache" on the engine page.
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
- A title shows in browse listings only when it has an active source; rows without one are identity anchors.
- Engine -> app calls need `EVO_SECRET_TOKEN`; app -> engine calls send it as `X-Evo-Secret`. Segment/variant URLs are HMAC-signed, so the engine never fetches a URL it did not hand out.

## Engine settings (`evo-engine`, read from `.env`)

`EVO_WEBHOOK_URL`, `MAX_CONCURRENT_EXTRACTIONS`, `MAX_CONCURRENT_DOWNLOADS`, `MIN_FREE_DISK_GB`, `CLEAN_ORPHANS_ON_START`. The extraction performance settings below are also live-editable under `/admin/evo/engines/<id>`.

## Extraction performance (engine)

- **Metrics**: every provider attempt records time, peak RAM and CPU of the engine process tree (`app/core/metrics.py`, table `extraction_metrics`). The task's event log shows one line per attempt ("CineSrc: ok · 8.2s · peak 612 MB · cpu 11.4s · no new browser"); `GET /metrics` and the engine page show median / p95 per provider for 24 h. The sampler reads `/proc` once per 200 ms, which costs under 1% of a core. With concurrent extractions the figures are per engine; benchmarks run one job at a time.
- **Browser pool** (`app/core/browser_pool.py`): `BROWSER_POOL_SIZE` long-lived Chromium processes, each driven from its own thread (Playwright's sync API is thread-bound). Every extraction gets a fresh isolated context that is closed afterwards. A browser is replaced after `BROWSER_MAX_USES` extractions, when its process tree passes `BROWSER_RECYCLE_RSS_MB`, or when it dies (the job is retried once on another). `BROWSER_POOL_SIZE=0` restores one fresh browser per extraction.
- **Asset blocking** (`BLOCK_ASSETS`, `app/core/filters.py`): images, fonts, media and ad/tracker hosts are not loaded on provider pages.
- **Shared extraction** (`app/services/extraction_cache.py`): the URLs of all qualities from one extraction are reused for `EXTRACTION_REUSE_TTL_S` (default 300 s). Reused URLs are validated first (the stream validator fetches the playlist and a chunk); if they no longer play, the title is extracted once more. Simultaneous requests for one title share the running extraction. Task events say "Reused extraction", "Fresh extraction" or "Shared an extraction that was already running".
- **Provider order**: `EXTRACTOR_ORDER` (`cinesrc,ythd` or `ythd,cinesrc`) decides which provider is tried first; the other is the fallback. Live-editable on the engine page ("Provider order" dropdown), read again on every job, no restart. Default CineSrc first.
- **"Title not found" is not a failure**: a provider that answers normally but has no copy of the title raises `TitleNotFound`. It never counts towards the cool-down below, so one missing title (retried a few times) cannot lock every provider out for everyone else. Only `PROVIDER_MISS_THRESHOLD` (default 10) such answers in a row, with no title found in between, cool a provider down (it is probably broken). CineSrc: the embed page opened but no playlist came. YtHD: no `vs_src`, 404, or no stream data after a fresh decryptor. Anything else (timeouts, 5xx, a page that never opened) is a real failure.
- **Provider cool-down** (`app/services/provider_health.py`): `PROVIDER_FAIL_THRESHOLD` consecutive failures within `PROVIDER_FAIL_WINDOW_S` put a provider on cool-down for `PROVIDER_COOLDOWN_S`; afterwards one trial request decides. If every provider is cooling down the job fails immediately with the reason. State is in memory; the engine page shows it with a Reset button.
- **YtHD decryptor cache** (`app/services/decryptor_cache.py`): `vsdec.js` is stored in `data/decryptors/` by the version the player page names, three versions kept; a failed decryption with a cached copy refreshes it once and retries. `YTHD_DECRYPTOR_CACHE=0` disables it.
- Benchmark: `python -m tests.benchmark` (synthetic, offline) or `python -m tests.benchmark --live <tmdb ids>`; reports land in `docs/evo-engine/benchmarks/`.

## Several engines

The app is the gateway and scheduler; there is no separate gateway service.

- **Config**: `EVO_ENGINES='["http://10.0.0.1:8000", {"url": "http://10.0.0.2:8000", "name": "Frankfurt"}]'`. A one-entry list is the single-engine setup and nothing else changes; unset, it defaults to `http://127.0.0.1:8000` (no claims, no health gating). Read at start: change it and restart or redeploy. All engines share `EVO_SECRET_TOKEN`; each engine's `EVO_WEBHOOK_URL` points at the same app. An engine's id is its address (`host-port`), so reordering the list is safe. The first engine owns tasks created before multi-engine.
- **Scheduling** (`lib/evo/scheduler.ts`, tables `evo_engines`, `evo_claims`, `evo_tasks`, `evo_subtitle_owners`): health (`/health` + `/queue`) is checked at most every 10 s and saved with the last good time. A new job goes to the healthy, non-draining engine with the lowest (active + queued) / parallelism, disk breaking ties; another quality of a title prefers the engine that already has that title (it can reuse the extraction). Jobs just placed are counted immediately so a burst spreads out.
- **No duplicates**: a job identity (`ingest:<type>:<tmdb>:<season>:<episode>:<quality>`, `sinhala:...`) is claimed with `INSERT ... ON CONFLICT DO NOTHING`; every request, from any app instance, then talks to the claimed engine, which joins the running job.
- **Routing**: `evo_tasks` records the owner of every task (also Sinhala jobs). Status, HLS playlists/segments, translate polling, admin task views and actions all go to the owner; subtitle ids are looked up in `evo_subtitle_owners`. Ownership never changes.
- **Completion**: the engine's webhook carries `taskId`; `promote()` credits the owning engine in `sources.engine_id` / `subtitles.engine_id`.
- **Failure**: a failed health check (or a failed call) stops new jobs to that engine; the next check that succeeds puts it back. Its tasks stay with it and report `ENGINE_UNAVAILABLE` (the player shows its normal error with Try again). A new request for a job claimed by an unavailable engine moves the claim to a healthy engine (a controlled retry: fresh extraction, new task). Admins can also use "Retry elsewhere" on a task.
- **Draining**: `/admin/evo/engines/<id>` -> Drain. No new jobs; active ones finish; the overview shows "safe to remove" once it is empty, after which it can be dropped from `EVO_ENGINES`.
- **Admin**: `/admin/evo` is the combined view (engines table, summed pipeline graph, tasks and sources with their engine); `/admin/evo/engines/<id>` has that engine's status, settings, queue, providers, metrics and tasks. Admin API calls take `?engine=<id>`.
- Tests: `tests/e2e/multi_engine.sh` (distribution, duplicate requests, routing, webhook credit, Sinhala), `claims.sh` (two processes racing one claim), `engine_failure.sh` (stop, retry elsewhere, recovery, drain) run against `evo-engine/stub_engine.py`, a real engine with fake providers/CDN. They refuse to run when a test title already has real sources, and clean up after themselves.

## Watching it run (admin)

`/admin/evo` shows engine health, a live **pipeline graph** (per-step outcome counts for the last 24h, refreshed every 5s), recent tasks and cached sources. Click a task for its own graph (`/admin/evo/<taskId>`): an n8n-style node view where each step lights up as it runs (running = pulsing gold with a live timer, ok = green, failed = red, skipped = grey, pending = dashed). Click a node for its event log. The page polls every 2s until the task settles.

The engine records one event per step transition (`task_events` in its SQLite; steps listed in `app/domain/models.py::STEPS`, mirrored in `lib/evo/flow.ts`). Endpoints: `GET /api/v1/media/tasks/{id}/events`, `GET /api/v1/media/pipeline/summary`. When adding a pipeline step, add it to both lists and emit events from `IngestService`.

## Tests

- Engine (stdlib `unittest`, fakes for the extractor, CDN, subtitles and model; no network, no spend): from `evo-engine`, `test/.venv/bin/python -m unittest discover -s tests -t .`. Covers the on-demand Sinhala job (dedup, budget cap, retry, subtitles-only webhook, HTTP validation) and that ingest no longer translates.
- Player (Playwright, all `/api/evo/*` calls and the CDN mocked): `pnpm build && pnpm start`, then `tests/e2e/run.sh`. It mints a throwaway session and removes it (and the source-less catalog row for TMDB 680) afterwards.
