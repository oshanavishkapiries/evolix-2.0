# Engine configuration push

The app merges global defaults with per-engine overrides, then sends a complete
state to `PUT /api/v1/media/config/push`, authenticated by `X-Evo-Secret`.
The request has `version` (positive integer), `values` (non-secret keys), and
`secrets` (encrypted API keys). Every field is validated before saving or applying
anything; unknown or invalid keys reject the whole push with 422. Older versions
return 409 with `{"detail":"stale","version":<accepted>}`; equal versions are
idempotent no-ops. Successful responses contain `version`, `applied`,
`restart_needed`, and `managed`.

Bootstrap-only identity, authentication, and bind settings are `EVO_SECRET_TOKEN`,
`ENGINE_NAME`, `EVO_BIND_ADDRESS`, and `EVO_PORT`. Local storage paths remain in the
environment too. Keep the initial reachable app URL in `EVO_WEBHOOK_URL`; unlike
identity/auth/bind settings, the callback URL can also be overridden by a push.
The managed resource, extraction, provider, translation, callback and API-key
settings are listed in `.env.example`. DB-pushed values override `.env`, which
overrides built-in defaults. Missing keys in the next full-state push restore
the original `.env` fallback, including secrets.

SQLite stores the last accepted push as a cache, retaining secret envelopes
rather than plaintext. Startup applies that cache before cleanup and job
recovery, even if the app is down. Only engines that have never accepted a push
load the legacy runtime_config table. Rotated tokens cause undecryptable cached
secrets to fall back to `.env` with a warning, without preventing startup.

`CLEAN_ORPHANS_ON_START` changes require restart because cleanup runs only during
startup. All other managed keys are live: browser pooling reads settings at
acquire/release, ingest limiters resize, and service calls read current credentials
and callback URLs. The app checks `config_version`, `config_managed`, and
`restart_needed` on `/health` and `/api/v1/media/queue`, re-pushing out-of-date
engines and letting an admin restart manually. Pending restart keys compare the
desired state with the actual running state and stay reported until restart or
until the desired state returns to the running value.

Secret transport uses AES-256-GCM, a 12-byte IV, a 16-byte tag, no AAD, and
`enc:v1:<iv>:<tag>:<ciphertext>` with unpadded base64url components. The key is
HKDF-SHA256 over the UTF-8 engine token, salt `evolix-engine-config-v1`, info
`engine-secrets`, length 32. A shared deterministic fixture is in
`tests/vectors/engine_config_crypto.json`.
