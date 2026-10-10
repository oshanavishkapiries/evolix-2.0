# Evolix 2.0 — Backend API guide for AI agents

This document tells an automated agent (or any script) everything it needs to **log in, add movies and TV
series, edit them, attach video sources and subtitles, and publish or unpublish them** on an Evolix
platform. Give this file to your agent together with the platform's base URL and an admin login.

- Base URL: the address the platform is served from, e.g. `https://evolix.example.com`
  (local development: `http://localhost:3000`). Every path below is relative to it.
- All request and response bodies are JSON unless stated otherwise (the provider import uses a file upload).
- Everything under `/api/admin/*` needs an **admin** account. Everything under `/api/me/*` is for the
  signed-in viewer and is rarely useful to an agent.

---

## 1. Quick start for an agent

1. **Log in** with `POST /api/auth/login` and keep the cookies (§2).
2. **Search TMDB** for the title: `GET /api/admin/tmdb/search?type=tv&query=better call saul`.
3. **Fetch the prefilled record**: `GET /api/admin/tmdb/tv/{tmdbId}` (or `/movie/{tmdbId}`).
4. **Create it** by POSTing that record (plus `"isPublished": true/false`) to `/api/admin/shows`
   (or `/api/admin/movies`). Seasons, episodes, images, cast and trailers all come along.
5. **Attach playable sources** (video URLs) and subtitles, individually (§8) or in bulk through the CSV/JSON
   provider import (§9).
6. **Publish** with `PATCH /api/admin/shows/{id}` `{"isPublished": true}`. Viewers only see published titles; a
   title without an active source shows as "Not available yet" and can't be played.

---

## 2. Authentication

Authentication is **cookie based** (HTTP-only cookies). There is no bearer-token header; use an HTTP client with a
cookie jar (`curl -c/-b`, Python `requests.Session`, Node `fetch` + a cookie jar, etc.).

| Cookie          | Path        | Lifetime (defaults) | Purpose                              |
| --------------- | ----------- | ------------------- | ------------------------------------ |
| `access_token`  | `/`         | 1 hour              | Sent automatically to every API call |
| `refresh_token` | `/api/auth` | 7 days              | Only sent to `/api/auth/*`           |

In production the cookies are `Secure`, so use **HTTPS**. Lifetimes are configurable server-side
(`ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS`).

**Who is an admin?** An account whose **verified** email is listed in the server's `ADMIN_EMAILS` setting.
Any other account gets `403 FORBIDDEN` on `/api/admin/*`. The admin account must already exist and be
email-verified (register + verify through the website, see §3 if you need to do it by API).

### 2.1 Log in

`POST /api/auth/login`

```json
{ "email": "admin@example.com", "password": "your-password" }
```

- `200` `{ "ok": true, "message": "Logged in" }` and two `Set-Cookie` headers.
- `401 INVALID_CREDENTIALS`, `403 EMAIL_NOT_VERIFIED`.

```bash
curl -c jar.txt -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"…"}' https://HOST/api/auth/login
```

### 2.2 Check the session / whether you are admin

`GET /api/auth/me` → `200 { "ok": true, "user": { "id", "email", "emailVerifiedAt" }, "isAdmin": true }`
or `401 UNAUTHORIZED`. **Call this after login and abort if `isAdmin` is false.**

### 2.3 Refresh when the access token expires

When any call returns `401 UNAUTHORIZED`, call `POST /api/auth/refresh` (no body, with the cookie jar). It rotates
both cookies: `200 { "ok": true, "message": "Refreshed" }`, or `401 INVALID_REFRESH_TOKEN` (log in again).
The refresh token is single-use and rotated each time, so always save the updated cookie jar.

```bash
curl -b jar.txt -c jar.txt -X POST https://HOST/api/auth/refresh
```

Recommended agent loop: on `401` → refresh once → retry the request once → if still `401`, log in again.

### 2.4 Log out

`POST /api/auth/logout` (this session) · `POST /api/auth/logout-all` (every device).

---

## 3. Other account endpoints (rarely needed)

All are `POST`, JSON bodies, no authentication. Responses never reveal whether an account exists.

| Endpoint                     | Body                                                        | Notes                                   |
| ---------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| `/api/auth/register`         | `{ email, password }` (password 8–128 chars)                | Emails a 6-digit code                   |
| `/api/auth/verify-email`     | `{ email, otp }` (`otp` = 6 digits)                         | Marks the email verified                |
| `/api/auth/resend-otp`       | `{ email, purpose: "verify_email" \| "reset_password" }`    | `429 OTP_COOLDOWN` + `retryAfter` secs  |
| `/api/auth/forgot-password`  | `{ email }`                                                 | Emails a reset code                     |
| `/api/auth/reset-password`   | `{ email, otp, newPassword }`                               | Revokes all sessions                    |

An agent cannot read the emailed codes, so create the admin account yourself on the website first.

---

## 4. Conventions

### 4.1 Response envelope

Every JSON response contains `ok` (`true` for status < 400). Errors look like:

```json
{ "ok": false, "code": "VALIDATION_ERROR", "message": "Invalid request",
  "issues": [{ "path": "tmdbId", "message": "Invalid input: expected number, received string" }] }
```

Always branch on the **HTTP status and `code`**, not on `message`.

| Status | `code`                        | Meaning                                                                             |
| ------ | ----------------------------- | ----------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`            | Body/query invalid; see `issues[]` (`path` = field). Also "No fields to update".    |
| 400    | `INVALID_BODY`                | Body is not valid JSON (or not multipart for uploads)                               |
| 401    | `UNAUTHORIZED`                | Missing/expired access cookie → refresh (§2.3)                                      |
| 403    | `FORBIDDEN`                   | Logged in but not an admin                                                          |
| 404    | `NOT_FOUND`                   | Unknown id, malformed UUID, or a referenced parent doesn't exist                    |
| 409    | `ALREADY_EXISTS`              | Title with that `tmdbId` exists; response includes `"id"` of the existing record    |
| 409    | `CONFLICT`                    | Unique-constraint clash (duplicate season/episode number, duplicate video key…)     |
| 413    | `FILE_TOO_LARGE`              | Provider import file larger than 2 MB                                               |
| 4xx/5xx| `TMDB_ERROR`                  | TMDB lookup failed (status mirrors TMDB's)                                          |
| 500    | `INTERNAL`                    | Unexpected server error (not your fault; retry later)                               |

### 4.2 IDs

Every record has a **UUID** `id`. Titles also have a numeric **`tmdbId`** (The Movie Database id). Do not mix them
up: `/api/admin/tmdb/*` takes the numeric TMDB id; every other endpoint takes the UUID.

### 4.3 PATCH semantics

`PATCH` endpoints update **only the fields you send**; unknown fields are rejected (`VALIDATION_ERROR`) and an
empty body is rejected ("No fields to update"). They return the full updated record.

### 4.4 Field formats

| Kind             | Format                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Dates            | `"YYYY-MM-DD"` or `null`                                                                         |
| Timestamps       | ISO 8601 with offset, `"2024-05-01T10:00:00Z"` or `null`                                         |
| Image paths      | **TMDB-relative paths** like `"/abc123.jpg"` (regex `^/[A-Za-z0-9_-]+\.(jpg\|jpeg\|png\|svg\|webp)$`), never full URLs |
| Ratings          | number 0–10 or `null`                                                                            |
| URLs (sources)   | absolute `http(s)://` URLs. `kind: "embed"` URLs must be `https://`                              |
| `sortOrder`      | integer −100000…100000; lower numbers come first                                                 |

### 4.5 Limits

Gallery backdrops: max **5**, no duplicates, must not contain the main `backdropPath`. Cast: max 50.
Genres: max 40. Videos on create: max 100. Seasons per show: 200; episodes per season: 2000.

### 4.6 What viewers can see

A title appears in the viewer catalog only when it `isPublished`; for shows, only `isVisible` seasons and episodes
are listed. It is **playable** only if the movie/episode has at least one `isActive` source (otherwise the viewer
sees "Not available yet"). Use these flags to publish/unpublish at each level.

---

## 5. TMDB lookup (read-only helpers)

TMDB must be configured on the server (`TMDB_API_KEY`). These save you from typing metadata by hand.

### `GET /api/admin/tmdb/search`

Query: `type` = `movie` | `tv` (required), `query` (required, ≤200), `page` (default 1).

```json
{ "ok": true, "page": 1, "totalPages": 3,
  "results": [ { "tmdbId": 60059, "title": "…", "year": 2015, "posterPath": "/p.jpg", "overview": "…", "alreadyAdded": true, "localId": "uuid-or-null" } ] }
```

`alreadyAdded` / `localId` tell you if the title already exists on this platform — **check this before creating**.

### `GET /api/admin/tmdb/movie/{tmdbId}` → `{ "movie": MoviePrefill }`
### `GET /api/admin/tmdb/tv/{tmdbId}` → `{ "show": ShowPrefill }`

Returns a complete, ready-to-create record: titles, overview, dates, genres, rating, poster/backdrop/logo and
gallery already auto-picked, cast, trailers (`videos`) and — for shows — every season with every episode
(`seasons[].episodes[]`). It also contains `images` (all candidate images) and, for shows, `warnings[]` (seasons
whose episodes failed to load). **You can POST the `movie`/`show` object straight to the create endpoint**
(extra keys such as `images` and `warnings` are ignored); add `"isPublished"` as desired.

### `GET /api/admin/tmdb/movie/{tmdbId}/images` · `GET /api/admin/tmdb/tv/{tmdbId}/images`

All image candidates (posters, backdrops, logos) plus the auto-picked `selection`. Use to choose different artwork,
then PATCH the paths onto the title.

### `GET /api/admin/tmdb/tv/{tmdbId}/season/{seasonNumber}/images` → `{ "posters": [...] }`

---

## 6. Movies

### 6.1 List — `GET /api/admin/movies`

Query (all optional): `q` (search title/original title), `status` = `published` | `draft`, `page`, `pageSize`
(max 100). **Without `page`/`pageSize` the full list is returned.**

```json
{ "ok": true, "total": 42, "page": 1, "pageSize": 20,
  "movies": [ { "id": "uuid", "tmdbId": 550, "title": "Fight Club", "releaseDate": "1999-10-15",
                "posterPath": "/abc.jpg", "isPublished": false } ] }
```

Newest first.

### 6.2 Get one — `GET /api/admin/movies/{id}`

`{ "movie": { …every field…, "videos": [Video] } }`

### 6.3 Create — `POST /api/admin/movies` → `201 { "movie": {…} }`

| Field              | Type            | Required | Default |
| ------------------ | --------------- | -------- | ------- |
| `tmdbId`           | positive int    | **yes**  |         |
| `title`            | string ≤500     | **yes**  |         |
| `originalTitle`    | string          |          | `""`    |
| `tagline`          | string ≤1000    |          | `""`    |
| `overview`         | string ≤5000    |          | `""`    |
| `releaseDate`      | date \| null    |          | `null`  |
| `runtimeMinutes`   | int \| null     |          | `null`  |
| `genres`           | string[]        |          | `[]`    |
| `rating`           | 0–10 \| null    |          | `null`  |
| `voteCount`        | int \| null     |          | `null`  |
| `originalLanguage` | string          |          | `""`    |
| `status`           | string          |          | `""`    |
| `posterPath` / `backdropPath` / `logoPath` | image path \| null | | `null` |
| `galleryBackdrops` | image path[] (≤5) |        | `[]`    |
| `cast`             | `{ name, character?, profilePath? }[]` (≤50) | | `[]` |
| `isPublished`      | boolean         |          | **`false`** |
| `videos`           | Video input[] (§7) |       | `[]`    |

`409 ALREADY_EXISTS` (with the existing `id`) when that `tmdbId` is already stored.

### 6.4 Update — `PATCH /api/admin/movies/{id}`

Any subset of the create fields except `tmdbId` and `videos`. **Publish / unpublish:** `{"isPublished": true}`.

### 6.5 Delete — `DELETE /api/admin/movies/{id}` → `200 {}`

Irreversible. Removes the movie's sources, subtitles and videos too.

---

## 7. TV shows, seasons, episodes

### 7.1 List — `GET /api/admin/shows`

Same query as movies. Rows: `{ id, tmdbId, name, firstAirDate, posterPath, isPublished }` under `"shows"`.

### 7.2 Get one — `GET /api/admin/shows/{id}`

The whole tree:

```json
{ "show": { "id": "…", "name": "…", "…show fields…": "…", "videos": [Video],
    "seasons": [ { "id": "…", "seasonNumber": 1, "name": "Season 1", "isVisible": true,
        "episodes": [ { "id": "…", "episodeNumber": 1, "name": "Uno", "isVisible": true, "…": "…" } ] } ] } }
```

### 7.3 Create — `POST /api/admin/shows` → `201 { "id": "uuid" }`

Show fields (same names/limits as movies, but `name`/`originalName`/`firstAirDate`/`lastAirDate`
instead of `title`/`originalTitle`/`releaseDate`; **no** `runtimeMinutes`) plus:

```json
{
  "tmdbId": 60059, "name": "Better Call Saul", "isPublished": false,
  "seasons": [
    { "tmdbId": 3624, "seasonNumber": 1, "name": "Season 1", "overview": "", "airDate": "2015-02-08",
      "posterPath": "/p.jpg", "isVisible": true,
      "episodes": [ { "tmdbId": 62085, "episodeNumber": 1, "name": "Uno", "overview": "…",
                      "airDate": "2015-02-08", "runtimeMinutes": 54, "stillPath": "/s.jpg", "isVisible": true } ] }
  ],
  "videos": []
}
```

Season numbers must be unique within the show, episode numbers unique within a season (`400`). `409
ALREADY_EXISTS` if the `tmdbId` exists. **Episodes and seasons can only be created here (at show creation)** —
there is no endpoint to add a single season/episode later (see §12).

### 7.4 Update show — `PATCH /api/admin/shows/{id}`

Any subset of the show fields (not `tmdbId`, `seasons`, `videos`). Publish: `{"isPublished": true}`.

### 7.5 Delete show — `DELETE /api/admin/shows/{id}`

Cascades to seasons, episodes, sources and subtitles.

### 7.6 Seasons

- `PATCH /api/admin/seasons/{seasonId}` — any of `seasonNumber, name, overview, airDate, posterPath, isVisible`.
  Returns `{ "season": {…} }`.
- `DELETE /api/admin/seasons/{seasonId}` — also deletes its episodes.
- `PATCH /api/admin/seasons/{seasonId}/episodes` body `{ "isVisible": true|false }` — show/hide **every episode**
  of the season in one call. Returns `{ "updated": <count> }`.

### 7.7 Episodes

- `PATCH /api/admin/episodes/{episodeId}` — any of `episodeNumber, name, overview, airDate, runtimeMinutes,
  stillPath, isVisible`. Returns `{ "episode": {…} }`.
- `DELETE /api/admin/episodes/{episodeId}`.

Episode and season ids come from `GET /api/admin/shows/{id}`.

---

## 8. Playable sources and subtitles

Sources are the actual video URLs viewers play. They attach to a **movie** or an **episode**
(never to a show or a season directly).

### 8.1 Sources

`GET /api/admin/sources?movieId={uuid}` or `?episodeId={uuid}` (exactly one) → `{ "sources": [Source] }`
ordered by `sortOrder`.

`POST /api/admin/sources` → `201 { "source": {…} }`

```json
{ "episodeId": "uuid",            // exactly one of movieId / episodeId
  "label": "Main 1080p",           // required, ≤200
  "kind": "hls",                   // "direct" (mp4/webm file) | "hls" (.m3u8) | "embed" (iframe page, https only)
  "url": "https://cdn.example.com/video.m3u8",   // required, absolute http(s) URL
  "quality": "1080p",              // optional
  "sortOrder": 0,                  // optional, default 0; lowest plays first
  "isActive": true }               // optional, default true
```

The server **never fetches** the URL; it only stores it. Make sure the URL is reachable by viewers' browsers
(CORS for direct/HLS; HTTPS pages can't play `http://` media).

`PATCH /api/admin/sources/{id}` — any of `label, kind, url, quality, sortOrder, isActive`.
`DELETE /api/admin/sources/{id}`. To take a source offline without deleting it: `{"isActive": false}`.

### 8.2 Subtitles

`GET /api/admin/subtitles?movieId=…|episodeId=…` → `{ "subtitles": [...] }`

`POST /api/admin/subtitles` → `201 { "subtitle": {…} }`

```json
{ "movieId": "uuid",                 // or episodeId
  "label": "English", "language": "en", "url": "https://…/en.vtt",
  "format": "vtt",                   // "vtt" | "srt"
  "sortOrder": 0 }
```

`PATCH /api/admin/subtitles/{id}` (same fields, all optional) · `DELETE /api/admin/subtitles/{id}`.

### 8.3 Trailers / videos (YouTube & Vimeo)

Videos are trailers etc. attached to a **movie or show** (not episodes). Stored by site + key (not a URL).

Video fields: `site` (`youtube` | `vimeo`), `key` (YouTube id `[A-Za-z0-9_-]{6,20}` or Vimeo numeric id), `name`
(required), `type` (`trailer`, `teaser`, `clip`, `featurette`, `behind_the_scenes`, `bloopers`,
`opening_credits`, `other`), `official` (bool), `language` (2-letter code or null), `publishedAt`,
`sortOrder`, `isVisible` (default true).

- `GET /api/admin/videos?movieId=…|showId=…` → `{ "videos": [...] }`
- `POST /api/admin/videos` → `201 { "video": {…} }` — body = fields above plus exactly one of `movieId` / `showId`.
  `sortOrder` omitted ⇒ appended last. `409` if the same site+key already exists on that title.
- `PATCH /api/admin/videos/{id}` · `DELETE /api/admin/videos/{id}`
- `POST /api/admin/videos/import-from-tmdb` body `{ "movieId": "…" }` or `{ "showId": "…" }` — tops the title up
  to 5 videos using the best-ranked TMDB videos not already stored. Returns `{ "added": n, "skipped": n }`.

---

## 9. Bulk source/subtitle import (CSV or JSON)

The efficient way to attach many URLs to a show with many episodes. Three steps.

### 9.1 Download a template — `GET /api/admin/movies/{id}/provider-template?format=csv|json`
### &nbsp;&nbsp;&nbsp;&nbsp;`GET /api/admin/shows/{id}/provider-template?format=csv|json`

Returns the title's structure (all seasons/episodes) with its **current** sources/subtitles, or a blank placeholder
row where there are none. `format` defaults to `csv`. The file download has a `Content-Disposition` filename.

JSON shape (what you should produce — you may also just edit the downloaded template):

```json
{ "type": "show", "title": "Better Call Saul", "tmdbId": 60059,
  "seasons": [ { "seasonNumber": 1, "name": "Season 1", "isVisible": true,
      "episodes": [ { "episodeNumber": 1, "name": "Uno", "isVisible": true,
          "sources":   [ { "label": "Main", "kind": "hls", "url": "https://…/s01e01.m3u8", "quality": "1080p", "sortOrder": 0, "isActive": true } ],
          "subtitles": [ { "label": "English", "language": "en", "url": "https://…/s01e01.en.vtt", "format": "vtt", "sortOrder": 0 } ] } ] } ] }
```

For a **movie**, the object is `{ "type": "movie", "title", "tmdbId", "sources": [...], "subtitles": [...] }`.

CSV columns: `entry, seasonNumber, seasonName, episodeNumber, episodeName, isVisible, label, kind, url, quality,
sortOrder, isActive, language, format`. `entry` is `source` or `subtitle`; the name/`isVisible` columns are
read-only context and ignored on import. Rows with an empty `url` are placeholders and ignored.

### 9.2 Dry run — `POST …/provider-import/preview`

`POST /api/admin/shows/{id}/provider-import/preview` (or `/movies/{id}/…`), **`multipart/form-data`** with a
`file` field (`.csv` or `.json`, ≤2 MB, ≤5000 entries). **Writes nothing.**

```bash
curl -b jar.txt -F 'file=@providers.json;type=application/json' \
  https://HOST/api/admin/shows/$SHOW_ID/provider-import/preview
```

```json
{ "ok": true,
  "summary": { "total": 24, "new": 22, "duplicates": 2, "errors": 0, "blank": 0, "sourcesNew": 22, "subtitlesNew": 0 },
  "rows": [ { "index": 1, "line": null, "entry": "source", "season": 1, "episode": 1,
              "url": "https://…", "status": "new", "message": "" } ],
  "truncated": false }
```

Row `status`: `new` (will be inserted), `duplicate` (same URL already on that episode/movie, or repeated in the
file — skipped), `error` (see `message`; skipped). Unknown season/episode numbers are errors.

### 9.3 Commit — `POST …/provider-import/commit`

Same request as the preview; re-validates and inserts only the `new` rows.

```json
{ "ok": true, "imported": { "sources": 22, "subtitles": 0 }, "skipped": 2, "blank": 0, "errors": 0 }
```

Always preview first and inspect `summary.errors`.

---

## 10. Recipes

### 10.1 Add a TV series, upload sources, publish

```text
1. POST /api/auth/login                                  (save cookies)
2. GET  /api/auth/me                                     (assert isAdmin)
3. GET  /api/admin/tmdb/search?type=tv&query=<name>      (pick result; stop if alreadyAdded → use localId)
4. GET  /api/admin/tmdb/tv/<tmdbId>                      (→ show)
5. POST /api/admin/shows   body = show + {"isPublished": false}     (→ { id })
6. GET  /api/admin/shows/<id>/provider-template?format=json   (→ structure)
7. Fill in sources[].url for each episode; POST …/provider-import/preview, then …/commit
8. PATCH /api/admin/shows/<id>  {"isPublished": true}
```

### 10.2 Add a movie

```text
search?type=movie → GET /api/admin/tmdb/movie/<tmdbId> → POST /api/admin/movies (isPublished:false)
→ POST /api/admin/sources {movieId, label, kind, url} → PATCH /api/admin/movies/<id> {"isPublished":true}
```

### 10.3 Unpublish / hide

- Whole title: `PATCH …/movies/{id}` or `…/shows/{id}` with `{"isPublished": false}` (keeps everything, just hides it).
- One season: `PATCH /api/admin/seasons/{id}` `{"isVisible": false}`; all its episodes at once: `PATCH
  /api/admin/seasons/{id}/episodes` `{"isVisible": false}`.
- One episode: `PATCH /api/admin/episodes/{id}` `{"isVisible": false}`.
- One broken source: `PATCH /api/admin/sources/{id}` `{"isActive": false}`.

### 10.4 Replace a title's artwork

`GET /api/admin/tmdb/movie/<tmdbId>/images` → choose a path → `PATCH …/movies/{id} {"posterPath": "/new.jpg"}`.

### 10.5 Audit what is published

`GET /api/admin/shows?status=published` and `GET /api/admin/movies?status=published&pageSize=100&page=1`.

### 10.6 Python example

```python
import requests
s = requests.Session()
BASE = "https://HOST"
r = s.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}); r.raise_for_status()
assert s.get(f"{BASE}/api/auth/me").json()["isAdmin"]

def call(method, path, **kw):
    r = s.request(method, BASE + path, **kw)
    if r.status_code == 401 and s.post(f"{BASE}/api/auth/refresh").ok:   # one refresh, one retry
        r = s.request(method, BASE + path, **kw)
    return r

hit = call("GET", "/api/admin/tmdb/search", params={"type": "tv", "query": "Better Call Saul"}).json()["results"][0]
if not hit["alreadyAdded"]:
    show = call("GET", f"/api/admin/tmdb/tv/{hit['tmdbId']}").json()["show"]
    show["isPublished"] = False
    show_id = call("POST", "/api/admin/shows", json=show).json()["id"]
```

---

## 11. Agent safety guidelines (recommended)

- **Read before you write**: search/list first to avoid duplicates (`ALREADY_EXISTS` is returned, but check anyway).
- **Prefer reversible actions**: unpublish (`isPublished:false`) or deactivate (`isActive:false`) instead of `DELETE`.
  `DELETE` cascades and cannot be undone.
- **Create as drafts** (`isPublished:false`), verify, then publish.
- Never log or echo the admin password or the cookie values.
- Don't call the API in tight loops; the TMDB endpoints hit an external service, and `GET /api/admin/tmdb/tv/{id}`
  fetches every season (can take several seconds).
- Treat `5xx` as retry-later; treat `4xx` as "fix the request" (read `issues[]`).

---

## 12. Not available through the API (current limitations)

- No endpoint to **add a single season or episode** to an existing show (only at show creation). A workaround is
  to delete and recreate the show, or ask the platform owner to add the endpoint.
- No endpoints to manage **users**, or to upload **video files** (sources are external URLs only).
- Admin endpoints return **all** records (published and drafts); there is no public/unauthenticated catalog API.
- Bearer tokens / API keys are not supported; use the cookie login. (An API-key mechanism could be added if you want
  an agent that never needs the password.)

---

## 13. Viewer endpoints (reference)

Signed-in viewer features; agents managing content normally don't need these. Both need the access cookie.

- `GET /api/me/bookmarks` → `{ movies: [uuid], shows: [uuid] }`.
  `POST /api/me/bookmarks` `{ kind: "movie"|"show", id, on: boolean }` → `{ bookmarked }`.
- `POST /api/me/progress` `{ kind: "movie"|"episode", id, position, duration }` (seconds) → `{ completed }`.
