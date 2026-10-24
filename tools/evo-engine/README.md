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

Edit `.env`: set `EVO_SECRET_TOKEN` to the generated token, set
`PIXELDRAIN_API_KEY` for media uploads, and set `EVO_WEBHOOK_URL` to your Next.js
application's public `/api/evo/complete` URL (or leave it empty to disable callbacks).
Set `OPENROUTER_API_KEY` if you need Sinhala translation. A translation budget of
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

In the **Next.js application's** environment, configure:

```dotenv
EVO_ENGINE_URL=https://engine.your-domain.example
EVO_SECRET_TOKEN=<same value as the engine's EVO_SECRET_TOKEN>
```

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
they do not resume automatically. The example configuration removes orphaned
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
