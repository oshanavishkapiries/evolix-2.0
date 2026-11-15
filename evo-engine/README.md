# Engine local CDN

`CDN_PROVIDER=pixeldrain` preserves the existing Pixeldrain backend. Select
`CDN_PROVIDER=local` in admin configuration or `.env` to store completed video
and subtitle files on the engine. Provider changes apply to subsequent uploads
without a restart; existing database URLs retain their provider scheme.

`LOCAL_CDN_DIR` defaults to `evo-engine/cdn` for native deployments. Docker Compose
mounts the named volume `engine-cdn` at `/app/cdn`; the image prepares that path
with the engine user's ownership. Changing the directory does not move files:
existing `evo-local://` references resolve against the currently configured path.
Keep one engine process per directory (the shipped Docker command uses one worker).

`LOCAL_CDN_VIDEO_GB=20` and `LOCAL_CDN_SUBTITLE_GB=5` are separate quotas in GiB.
Docker cannot cap this named volume's size: the application enforces the quotas
before each upload, evicting the least recently accessed unpinned files. A file
larger than its pool's entire quota fails caching and retains the normal streaming
fallback. Reducing a quota takes effect before the next upload to that pool.
`MIN_FREE_DISK_GB` also protects free disk on the volume. Downloads, temporary
copies, and the small SQLite index need additional disk space outside pool usage.

Uploads reserve quota before copying, then copy and fsync outside the playback
lock. Concurrent uploads wait for outstanding reservations when needed, so they
cannot overshoot a pool quota or stall file opens. Uploads use temporary files,
fsync and atomic rename. The SQLite LRU index is
reconciled once on startup; incomplete temporary files are removed. Playback pins
last until the streaming response closes; pinned files cannot be evicted, purged,
or explicitly deleted. Successful GETs refresh access order at most once per file per 60 seconds to
avoid repeated SQLite fsyncs during Range playback; HEAD does not.

Stored URLs are `evo-local://<opaque-id>.<extension>`. Applications resolve these
using the owning engine rather than using them directly as browser URLs. The
shared-secret-protected `GET|HEAD /api/v1/media/files/{file_id}` endpoint supports
single byte ranges, suffix ranges, open-ended ranges, 206 and 416 responses, and
If-Range entity tags. Files are streamed with bounded reads. Missing files return
404, and the engine's local liveness check allows a subsequent ingest to retry.

Admin endpoints use the same shared secret:

- `GET /api/v1/media/cdn/files` lists the selected provider's files.
- `POST /api/v1/media/cdn/delete` accepts `{"url":"evo-local://..."}` when local is selected.
- `POST /api/v1/media/cdn/delete-many` accepts `{"urls":["evo-local://..."]}`.
- `GET /api/v1/media/cdn/local/usage` reports per-pool used bytes, quota bytes, file counts and oldest access timestamps.
- `POST /api/v1/media/cdn/local/purge` removes all unpinned local files and reports retained pins.

Pixeldrain account and album endpoints return 409 while local storage is selected.
Local subtitle URLs ending in `.vtt` are accepted as translation sources on the
owning engine; the engine reads these directly under a playback pin.

Run the offline test suite from `evo-engine`:

```sh
test/.venv/bin/python -m unittest discover -s tests -t .
```
