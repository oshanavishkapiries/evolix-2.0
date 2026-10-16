# Evo pipeline

The catalog is TMDB-driven. A title becomes playable the first time someone plays it; the engine then caches it to the CDN so later plays never touch the upstream provider.

## Flow

1. Viewer opens `/watch/movie/tmdb-N` (or an episode). Signed in: `ensureMovie` / `ensureEpisode` (`lib/evo/ensure.ts`) create the catalog row (published, no sources), so progress, bookmarks and reports have a UUID to attach to.
2. No source yet -> `EvoPlayer` calls `POST /api/evo/ingest` (session required, rate limited, TMDB-validated). The engine extracts streams and flips to `STREAMING`: playback starts through the signed HLS proxy.
3. In the background the engine downloads the chosen quality (`-movflags +faststart`), verifies size/duration, uploads to Pixeldrain, uploads the subtitle tracks, then reports `POST /api/evo/complete` (secret-protected, retried). `/api/evo/status` also reconciles a finished task if the webhook was lost.
4. `promote()` (`lib/evo/promote.ts`) upserts one `sources` row per quality (`audio_language = 'en'`, 720p sorted first) and one `subtitles` row per language, then expires the catalog cache tag.
5. From then on the title plays straight from the CDN. Missing qualities can be requested from the Sources panel ("Get 1080p"); a CDN file that disappears is deactivated by `/api/evo/heal` and the title falls back to another quality or a fresh ingest.

## Invariants

- `sources` is unique per `(movie_id | episode_id, quality)`; `subtitles` per `(parent, language)`. Promotion is idempotent.
- A title shows in browse/Kids listings only when it has an active source; rows without one are identity anchors.
- Engine -> app calls need `EVO_SECRET_TOKEN`; app -> engine calls send it as `X-Evo-Secret`. Segment/variant URLs are HMAC-signed, so the engine never fetches a URL it did not hand out.

## Engine settings (`tools/evo-engine`, read from `.env`)

`EVO_WEBHOOK_URL`, `MAX_CONCURRENT_EXTRACTIONS`, `MAX_CONCURRENT_DOWNLOADS`, `MIN_FREE_DISK_GB`, `CLEAN_ORPHANS_ON_START`, `CORS_ORIGINS`.

## Watching it run (admin)

`/admin/evo` shows engine health, a live **pipeline graph** (per-step outcome counts for the last 24h, refreshed every 5s), recent tasks and cached sources. Click a task for its own graph (`/admin/evo/<taskId>`): an n8n-style node view where each step lights up as it runs (running = pulsing gold with a live timer, ok = green, failed = red, skipped = grey, pending = dashed). Click a node for its event log. The page polls every 2s until the task settles.

The engine records one event per step transition (`task_events` in its SQLite; steps listed in `app/domain/models.py::STEPS`, mirrored in `lib/evo/flow.ts`). Endpoints: `GET /api/v1/media/tasks/{id}/events`, `GET /api/v1/media/pipeline/summary`. When adding a pipeline step, add it to both lists and emit events from `IngestService`.
