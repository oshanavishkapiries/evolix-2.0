Application configuration is declared in `registry.ts`. Server consumers must `await getConfig()`;
there is no synchronous accessor for database settings. Effective precedence per key is DB, environment,
then registry default. Required values without a default throw an error naming the key. DB read failures
log one sanitized warning per process and use environment/default values, so existing deployments keep
working before the generated migration is applied. Do not apply migrations as part of config tests.

`getConfigSource(key)` returns `db`, `env`, or `default`. `getRawConfigForAdmin()` returns effective values
and sources with all secrets masked; never send `getConfig()` output to a browser. All app settings have
`restartNeeded: false`. The cache lasts 15 seconds, coalesces concurrent loads, and is invalidated locally
after writes. Other processes see a write within their cache TTL. Engine-list memoisation keys on the
current config string; SMTP transport memoisation keys on its current connection settings.

Use `setConfig`, `resetConfig`, and `rollbackConfig` from `store.ts` on authenticated admin server paths.
The actor must be an email address; these primitives do not replace route authorization. Blank secret
input means keep the current value and produces no write. Explicit reset deletes the DB override and
restores the environment/default value. JSON-encoded secret values are encrypted at rest using the
bootstrap `CONFIG_ENCRYPTION_KEY`. Keep that key stable and backed up; changing it without re-encrypting
stored settings makes existing envelopes unreadable.

Every actual change and its audit row commit atomically in one SQL statement (Neon HTTP does not
support interactive transactions). Compare-and-swap retries concurrent edits to avoid recording a
stale previous value. Audit values record effective values; secret values are masked, including values
that previously came from the environment. **Secrets cannot be rolled back from audit history**:
`rollbackConfig` refuses secret keys with a clear error, because audit rows contain masks rather than
recoverable plaintext or ciphertext. Supply the secret again to restore it. Nonsecret rollback restores
the entry's pre-change effective value as a DB override; reset explicitly to restore fallback precedence.

`proxy.ts` in this repository runs on Next 16's Node runtime and already accesses the DB for admin and
title checks. Its auth dependencies therefore use DB config too, so JWT rotation remains consistent
with login. This is not an Edge loader: browser and Edge modules must not import it. The config test
suite checks browser/Edge static import graphs and awaits at migrated helper call sites. The existing
`NODE_ENV`, `NEXT_RUNTIME` and build-time `NEXT_PUBLIC_*` accesses remain ordinary runtime/environment
values; `lib/env.ts` exposes only bootstrap settings.

Phase 4 transport helpers use HKDF-SHA256 with UTF-8 engine-token input, salt `evolix-engine-config-v1`,
info `engine-secrets`, and 32 output bytes. AES-256-GCM uses a random 12-byte IV, a 16-byte tag, and no
AAD; envelopes are `enc:v1:<iv>:<tag>:<ciphertext>` with unpadded base64url segments. Engine transport
keys are independent of the app master encryption key.

The `/admin/config` page uses the registry's browser-safe metadata and validators, the shared
admin form/save-bar hooks, masked snapshots, and a separate read-only bootstrap summary.
`PUT /api/admin/config` accepts a plain key/value object, validates every key first, and calls
`setConfigBatch`: one SQL statement commits every override and audit together, or rolls all
of them back on conflict/failure. Concurrent batch conflicts return a sanitized failure;
reload/retry rather than silently overwriting another administrator's edit. The route and
batch store refuse an ADMIN_EMAILS change that omits the acting administrator's own address.
Reset and rollback routes apply the same guard to the resulting effective allow-list.

`GET /api/admin/config` returns `{ok, data, bootstrap}`; successful PUT, DELETE of
`/api/admin/config/[key]`, and POST to `/api/admin/config/audit/[id]/rollback` return the
same masked snapshot. Validation failures return status 422 and `{ok:false, code, message,
errors?:{[key]:message}}`. All handlers authorize with the normal admin cookie/session guard
before accessing settings; the authenticated email is the audit actor. Unexpected exceptions
produce a generic error and never include database/request/secret details.

`GET /api/admin/config/audit?key=SMTP_PORT&limit=25&before=<cursor>` returns `{ok, data, next}`.
History is app-scoped, ordered by descending timestamp and UUID, and uses the opaque `next`
cursor for older pages, including entries sharing a timestamp. Secret history is defensively
masked again at the API boundary and carries `canRollback:false` plus a human-readable reason.
Reset refuses to remove an override if its environment/default fallback is invalid or missing.
