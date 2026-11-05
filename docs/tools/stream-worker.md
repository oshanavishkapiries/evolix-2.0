# Stream Worker

A Cloudflare Worker that gives the engines' video an HTTPS address, so the browser plays from Cloudflare instead of
through a Vercel function. Video bytes stop counting as Vercel Fast Origin Transfer.

```
 before   browser --https--> Vercel function --http--> engine
 after    browser --https--> this Worker      --http--> engine
```

The engines are **not changed or redeployed**. The Worker calls the same `/api/v1/media/stream/...` routes the Vercel
proxy calls, with the same shared secret. It serves only `master.m3u8`, `variant.m3u8` and `segment` of a task id.

## Deploy (once)

1. **Engine hostnames.** Cloudflare cannot fetch a bare IP. Use a hostname for every engine, in the app's
   `EVO_ENGINES` and in the Worker, e.g. `http://169-58-244-90.sslip.io:8000`. The two lists must match.
2. In this folder: `pnpm dlx wrangler@4 login`
3. Edit `wrangler.toml`: set `EVO_ENGINES` (same value as the app) and `ALLOWED_ORIGINS` (your site).
4. `pnpm dlx wrangler@4 secret put EVO_SECRET_TOKEN` (same token the engines use)
5. `pnpm dlx wrangler@4 deploy` -> prints `https://evolix-stream.<you>.workers.dev`

## Check it before switching anything

```
 pnpm tsx tools/stream-worker/keys.ts '<EVO_ENGINES value>'     # prints the key of each engine
 curl -i https://evolix-stream.<you>.workers.dev/<key>/00000000-0000-4000-8000-000000000000/master.m3u8
```

- `404  Stream error: 404`  the Worker reached the engine and the token works. This is the good answer.
- `502  Stream source unreachable`  Cloudflare could not connect: check the hostname and the port (a Worker may not
  reach every port; port 80 is the safest).
- `401/403  Stream error: ...`  the secret on the Worker differs from the engine's token.

## Switch on / off

- On: set `STREAM_BASE=https://evolix-stream.<you>.workers.dev` in the app (Vercel) and redeploy.
- Off: remove `STREAM_BASE` and redeploy. Players use the built-in `/api/evo/stream` proxy again.
- `STREAM_BASE` is read by the server routes `/api/evo/ingest` and `/api/evo/status/*`, which hand out the stream URL.

## Notes

- Playlists are `no-store`; segments get `private, max-age=300`. The Worker does not use Cloudflare's cache: it does
  not work on `workers.dev` addresses.
- CORS is limited to `ALLOWED_ORIGINS`, so other sites cannot play from this Worker in a browser.
- Free plan: 100,000 requests a day (a movie is roughly 1,000 segment requests).
- Tests: `pnpm test:stream-worker`.
