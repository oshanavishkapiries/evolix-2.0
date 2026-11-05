# Error tracking

Self-hosted, Sentry-style error tracking: errors from the Next.js server, browsers and Evo engines are grouped into
issues in Postgres and shown in **Admin > Errors**, with alerts for new issues and regressions.

## How errors get in

| Source | Capture point | Notes |
| --- | --- | --- |
| Server | `instrumentation.ts` `onRequestError` | Rendering, route handlers, server actions, proxy. |
| Server | `lib/errors/register-node.ts` | `unhandledRejection` and uncaught exceptions. |
| Server | `captureException()` calls | Places that catch and answer 500 themselves (`adminRoute`, Evo completion, OTP mail, TMDB fallback). |
| Browser | `instrumentation-client.ts` | `window.onerror`, unhandled rejections, error boundaries, player boundary. |
| Engine | `evo-engine/app/core/error_reporting.py` | Any `logger.exception(...)` / ERROR log with a traceback. |

Browsers and engines POST to `/api/errors` (same origin only for browsers; engines send `X-Evo-Secret`). Reports are
rate limited per IP and size capped. Use `captureException(err, { route, tags })` from `lib/errors/capture.ts` anywhere
on the server where an error is caught and swallowed.

## What is stored

- `error_issues`: one row per fingerprint (source + error type + message with numbers/ids/strings stripped + top
  in-app frame). Holds status, counts, first/last seen, releases.
- `error_events`: sampled occurrences with stack, parsed frames (with source context), URL, route, user, user agent,
  release, breadcrumbs and scrubbed request headers. At most 10 per issue per minute are stored; the newest 100 per
  issue are kept, and nothing older than 30 days.
- `error_issue_days`: exact per-day counts (Sri Lanka days) for charts.

Cookies, `Authorization`, `X-Evo-Secret`, JWTs, API keys and `password=`-style values are removed before storing.

## Readable stack traces

`next.config.ts` turns on browser and server source maps. The server resolves frames from the `.map` files on disk
(`lib/errors/symbolicate.ts`) and attaches the surrounding source lines. `proxy.ts` answers 404 for any `*.map`
request, so the maps are never published. Server stacks are also mapped by Node (`process.setSourceMapsEnabled`).

## Statuses and alerts

- **Resolve**: fixed. A new occurrence reopens the issue and alerts as a regression.
- **Ignore**: keeps counting, hidden from the default list, never alerts.
- **Delete**: removes the issue and its history; a new occurrence starts a new issue.

Alerts (at most one per issue per hour) go to `ERROR_ALERT_EMAILS` (default `ADMIN_EMAILS`) and, if set,
`ERROR_ALERT_WEBHOOK` (Discord or Slack incoming webhook). Set `APP_URL` so alerts link to the issue.
Each event carries the release (git commit at build time, `NEXT_PUBLIC_RELEASE`).

Use the **Test server error** / **Test browser error** buttons on the Errors page to check the pipeline end to end.
