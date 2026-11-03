# Evo Engine deployment

Evo Engine runs independently of the Next.js application. It serves FastAPI on
port 8000, extracts streams with Playwright Chromium, processes media with
FFmpeg/FFprobe, and stores task history, runtime settings, and translation usage
in SQLite. Its own `requirements.txt` covers the engine; `../requirements.txt`
is for the other media tools.

## Deploy with Docker Compose

Run from the repository root:

```bash
cd tools/evo-engine
cp .env.example .env
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

Edit `.env`: set `EVO_SECRET_TOKEN` to the generated token and set
`EVO_WEBHOOK_URL` to your Next.js application's public `/api/evo/complete` URL
(or leave it empty to disable callbacks). Configure `PIXELDRAIN_API_KEY` for
uploads and `OPENROUTER_API_KEY` for Sinhala translation in admin config, or
uncomment their environment fallbacks until they are saved in the app DB. A translation budget of
`0` means unlimited; set a positive dollar amount to cap daily translation spend.

```bash
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:8000/health
docker compose logs -f evo-engine
```

Compose binds to `127.0.0.1:8000` by default, suitable for a reverse proxy on the
same host. For an application hosted elsewhere, point an HTTPS reverse proxy at
this port and configure the engine's public URL in Next.js. To publish directly
on the host's network interfaces, set `EVO_BIND_ADDRESS=0.0.0.0`; `EVO_PORT`
changes the host port. The container always listens on port 8000.

In the Next.js admin engine registry, register this engine's public URL and its
own `EVO_SECRET_TOKEN`. Each engine has a separate token. The app pushes merged
global configuration and per-engine overrides; existing environment configuration
continues to work before the first push.

If Next.js runs directly on the same host, its engine URL can be
`http://127.0.0.1:8000`. If it shares a Docker network with the engine, use
`http://evo-engine:8000`. URLs using localhost inside a container refer to that
container, so use a reachable address for callbacks too.

## Persistence and resources

Compose creates three named volumes:

| Volume | Container directory | Contents |
| --- | --- | --- |
| `engine-data` | `/app/data` | SQLite tasks, events, settings, and translation ledger |
| `engine-downloads` | `/app/downloads` | In-progress media downloads |
| `engine-temp` | `/app/temp` | Subtitle files and their cache index |

These survive container rebuilds and `docker compose down`. `docker compose down -v`
deletes them. Back up the data and subtitle volumes together. To migrate an existing
installation, stop the old service, copy its `data/` and `temp/` contents into the
corresponding volumes, and ensure they are writable by UID/GID `10001:10001`.
Bind mounts also need those permissions.

Keep one engine container with one Uvicorn worker: job queues, locks, and caches
live in process memory. Jobs interrupted by a restart are marked failed at startup;
they do not resume automatically. Setting CLEAN_ORPHANS_ON_START=true removes orphaned
download files on startup.

Allow disk space for concurrent full media downloads. By default, background media
caching is skipped below 10 GB free disk; streaming still works. Compose provides
1 GB of shared memory for Chromium. Tune concurrency to your host's resources.

The image runs as a non-root user, includes a child-process init and `/health`
check, and installs Chromium using the pinned Playwright package so the browser
version matches. See the [Playwright browser installation guide](https://playwright.dev/python/docs/browsers).

## Docker without Compose

From `tools/evo-engine`, after configuring `.env`:

```bash
docker build -t evo-engine:local .
docker run -d --name evo-engine --restart unless-stopped \
  --env-file .env \
  --shm-size=1g \
  --stop-timeout=120 \
  -p 127.0.0.1:8000:8000 \
  -v engine-data:/app/data \
  -v engine-downloads:/app/downloads \
  -v engine-temp:/app/temp \
  evo-engine:local
```

Compose checks that `EVO_SECRET_TOKEN` is set; when running Docker directly, ensure
you set it yourself. The application accepts unauthenticated requests when it is empty.

## App-managed configuration

Keep `EVO_SECRET_TOKEN`, `ENGINE_NAME`, `EVO_BIND_ADDRESS`, `EVO_PORT`, and the
initial app callback address (`EVO_WEBHOOK_URL`) in the engine environment.
`EVO_WEBHOOK_URL` is also push-managed and can override that initial address.
Storage paths (`DOWNLOAD_DIR`, `TEMP_DIR`, `SQLITE_DB_PATH`) stay local deployment
settings. The app's first deployment still needs its login-critical environment
keys until an admin saves them in its database.

All resource limits, browser/extractor/provider settings, `TRANSLATE_*`,
`PIXELDRAIN_API_KEY`, `OPENROUTER_API_KEY`, `EVO_WEBHOOK_URL`, and `ERROR_REPORT_URL`
are push-managed. Effective precedence is app DB > engine .env > built-in default;
when a full-state push omits a managed key, it returns to the original environment
fallback. Optional environment entries may be removed once stored in the app DB.

Authenticated `PUT /api/v1/media/config/push` accepts the full desired state with
an increasing version. Secrets travel as AES-256-GCM envelopes using a key derived
from this engine's token with HKDF-SHA256. SQLite caches the accepted version,
non-secret values, and encrypted secret envelopes, so startup needs no app
connection. Decrypted secrets exist in memory only. After token rotation, cached
secrets that cannot decrypt fall back to the environment with a warning; re-push
with the new token to restore them.

`GET /health` and `GET /api/v1/media/queue` report `config_version`,
`config_managed`, and `restart_needed` (key names only). `CLEAN_ORPHANS_ON_START`
requires a manual restart because cleanup only runs at startup. Browser pool size
and recycle limits read live settings; extraction/download limiters are resized
by `IngestService.apply_config()`. Other settings take effect on subsequent jobs
or calls. A pending startup value remains reported until restart or a push
restores the value the current process uses.

Before the first push, existing SQLite runtime overrides and legacy admin edits
continue to work. Afterwards, legacy `PUT /api/v1/media/config` and
`DELETE /api/v1/media/config/{key}` return 409 (`Managed by the app`).
`GET /api/v1/media/config` continues to expose a masked snapshot with per-key
`source` (`push` or `env`), `live`, and `restart_needed`. See
[the configuration pipeline](docs/config-push.md).
