# Implementation Plan: Hybrid Media Architecture with Evolix 2.0 Design System

## Goal Description
Integrate the newly built, SOLID-compliant **Evo-Engine** into the **Evolix 2.0** application while strictly following the **Plex-inspired Charcoal & Evolix Gold (`#f5a623`)** design system and token rules.
This implementation provides:
1. **Hybrid Catalog**: Direct managed movies/shows play immediately via the existing Vidstack player; un-ingested TMDB catalog titles display an **"Evo Engine" / "On Demand"** badge in Evolix gold.
2. **Branded Evo Progress Player Screen**: A dedicated progress screen rendered within the watch shell with live progress feedback (`EXTRACTING` $\rightarrow$ `DOWNLOADING` $\rightarrow$ `UPLOADING`), animated pulse rings, and progress indicators using the application's exact CSS tokens (`tokens.css`, `components.css`).
3. **Seamless Transition**: Auto-switches to the native `<WatchPlayer />` once the task reaches 100% completion.
4. **Secure Vercel Reverse Proxy**: Vercel-deployed Next.js routes (`/api/evo/ingest` and `/api/evo/status/[taskId]`) securely forward calls to the VPS Evo-Engine microservice using an internal bearer secret token (`EVO_SECRET_TOKEN`), keeping the VPS IP and port completely hidden from the browser.

---

## User Review Required

> [!IMPORTANT]
> **Evo-Engine Secret Token**:
> We will add two optional environment variables to Next.js (`lib/env.ts` and `.env`):
> - `EVO_ENGINE_URL`: e.g., `http://127.0.0.1:8000` (or `http://<VPS_IP>:8000` on Vercel).
> - `EVO_SECRET_TOKEN`: Shared secret key between Next.js and the Evo-Engine FastAPI service.
> When not configured, the app safely skips Evo-Engine proxying and logs a warning.

> [!NOTE]
> **Design Consistency**:
> The custom progress screen and badges will exclusively use:
> - Surface: `--v-bg` (`#1f1f1f`), `--v-card` (`#2a2a2a`), `--v-muted` (`#3a3a3a`), `--v-border`.
> - Accent: `--v-primary` (`#f5a623`), `--v-primary-hi` (`#ffb83d`), `--v-primary-fg` (`#1a1a1a`).
> - Typography & Layout: `Noto_Sans`, `--v-radius` (`.375rem`), and Plex-style pill badges.

---

## Proposed Changes

Separated by component layer:

### 1. Environment & Next.js Reverse Proxy (`lib/env.ts`, `app/api/evo/`)

#### [MODIFY] [`lib/env.ts`](file:///home/ubuntu/PROJECTS/evolix-2.0/lib/env.ts)
- Add optional `EVO_ENGINE_URL` (defaulting to `http://127.0.0.1:8000`) and `EVO_SECRET_TOKEN` (defaulting to empty string).

#### [NEW] `app/api/evo/ingest/route.ts`
- Endpoint: `POST /api/evo/ingest`
- Body: `{ tmdbId: number, mediaType?: "movie" | "tv", quality?: string }`
- Actions:
  - Verifies session/user authentication (optional or standard rate limit).
  - Forwards request to `${env.EVO_ENGINE_URL}/api/v1/media/ingest` with `X-Evo-Secret` header.
  - Returns `{ taskId, status, message }`.

#### [NEW] `app/api/evo/status/[taskId]/route.ts`
- Endpoint: `GET /api/evo/status/[taskId]`
- Actions:
  - Forwards to `${env.EVO_ENGINE_URL}/api/v1/media/status/${taskId}`.
  - Returns `{ taskId, tmdbId, status, progressPct, message, resultUrl, title, resolvedQuality }`.

---

### 2. Microservice Auth Hardening (`tools/evo-engine/`)

#### [MODIFY] [`tools/evo-engine/app/core/config.py`](file:///home/ubuntu/PROJECTS/evolix-2.0/tools/evo-engine/app/core/config.py)
- Add `EVO_SECRET_TOKEN: str = ""` setting.

#### [MODIFY] [`tools/evo-engine/app/api/routes.py`](file:///home/ubuntu/PROJECTS/evolix-2.0/tools/evo-engine/app/api/routes.py)
- Add header validation dependency: if `EVO_SECRET_TOKEN` is set, incoming requests must provide matching `X-Evo-Secret`.

---

### 3. Viewer Design System & Badging (`app/(viewer)/`)

#### [MODIFY] [`app/(viewer)/styles/cards.css`](file:///home/ubuntu/PROJECTS/evolix-2.0/app/%28viewer%29/styles/cards.css)
- Add styling for the Evo Engine On-Demand badge:
  ```css
  .v-card-badge-evo {
    position: absolute;
    top: 0.4rem;
    left: 0.4rem;
    z-index: 2;
    padding: 0.2rem 0.5rem;
    border-radius: var(--v-radius);
    background: rgb(245 166 35 / 0.9);
    color: var(--v-primary-fg);
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.5);
  }
  ```

#### [MODIFY] [`app/(viewer)/_components/media-card.tsx`](file:///home/ubuntu/PROJECTS/evolix-2.0/app/%28viewer%29/_components/media-card.tsx)
- Support `isEvo?: boolean` on `Card`.
- Render `<span className="v-card-badge-evo">Evo Engine</span>` on Evo-marked cards.

---

### 4. Custom Evo Progress Player Component (`app/(viewer)/_components/`)

#### [NEW] `app/(viewer)/styles/evo-progress.css`
- Dedicated styling for the progress player utilizing `--v-primary` and `--v-bg`:
  - Ambient backdrop blur with dark gradient overlay.
  - Animated gold progress bar and circular stage indicators.
  - Real-time status text (*"Decrypting stream..."*, *"Lossless remuxing..."*, *"Connecting CDN..."*).

#### [NEW] `app/(viewer)/_components/evo-progress-screen.tsx`
- Client component rendering the visual stage breakdown:
  1. **Phase 1: Resolving Stream** (Cloudflare evasion & WASM decryption).
  2. **Phase 2: Downloading & Remuxing** (HLS to MP4 remux).
  3. **Phase 3: CDN Cloud Sync** (Fast streaming preparation).
- Provides Cancel / Back buttons styled with `.v-btn`.

#### [NEW] `app/(viewer)/_components/evo-player.tsx`
- Handles the full client-side lifecycle:
  - If a direct source is provided, immediately mounts `<WatchPlayer />`.
  - If no source is available, starts `/api/evo/ingest` and displays `<EvoProgressScreen />`.
  - Continuously polls `/api/evo/status/[taskId]` every 1500ms.
  - When status hits `COMPLETED`, updates source to `result_url` and seamlessly switches to the Vidstack player.

#### [MODIFY] [`app/(viewer)/watch/movie/[id]/page.tsx`](file:///home/ubuntu/PROJECTS/evolix-2.0/app/%28viewer%29/watch/movie/%5Bid%5D/page.tsx)
- Check if movie has active sources in DB.
- If no active source or if marked with Evo Engine, render `<EvoPlayer />` with fallback support.

---

## Verification Plan

### Automated Tests
1. **Evo-Engine Auth Check**:
   ```bash
   curl -H "X-Evo-Secret: testsecret" http://127.0.0.1:8000/health
   ```
2. **Next.js Proxy Endpoint Verification**:
   ```bash
   curl -X POST http://localhost:3000/api/evo/ingest -H "Content-Type: application/json" -d '{"tmdbId": 1148365}'
   ```
3. **Build & Lint Check**:
   ```bash
   pnpm build
   ```

### Manual Verification
1. **Catalog View**: Open `/movies` in browser $\rightarrow$ observe cards styled with the gold "Evo Engine" badge.
2. **Evo Progress Flow**: Click an Evo-Engine movie $\rightarrow$ verify the branded dark/gold progress screen appears with live percentage and stage feedback.
3. **Playback Transition**: When 100% is reached, verify it auto-launches the Vidstack player and streams with full seeking/scrubbing controls.
4. **Git Tree Check**: Run `git status` to ensure all commits are clean.
