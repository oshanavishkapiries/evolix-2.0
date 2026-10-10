# Spec: Viewer UI redesign (Plex-inspired)

- **Status:** Implemented on branch `ui-redesign` (decisions in §10, notes in §11)
- **Date:** 2026-10-10
- **Scope:** viewer app only (`app/(viewer)/**`, `app/(viewer)/styles/*.css`). Out of scope: admin CMS, auth pages, the full-screen player shell (`watch-shell.tsx`, which keeps its own look).
- **Reference:** `/home/ubuntu/TEMP/ui-idea.zip`, 7 screenshots of Plex Web (splash, Home, collapsed sidebar, Movies & Shows, Discover, show detail top, show detail scrolled).

## 1. Goal

Redesign the Evolix viewer so its layout, density and feel are as close as practical to the Plex Web reference. Navigation should feel app-like and smooth, with motion that is purposeful and quick, and it must work well from 360px phones to 4K screens.

**Not a goal:** cloning Plex. We keep the Evolix name, logo and gold accent, our own icons and our own copy. We don't copy Plex assets, the Plex logo, or features we don't have (Live TV, Go Premium, Find Friends, casting).

## 2. What we take from the reference

| Reference pattern | Evolix version |
|---|---|
| Thin full-width **top bar**: hamburger, logo, pill search, account avatar on the right | Same. Search becomes a pill input in the top bar on every breakpoint ≥ 768px. |
| **Left sidebar** with icon + label items and a gold active indicator; collapses to an icon rail (screenshot 3) | Same. Items: Home, Movies, TV Shows, My List, Search (mobile only), Account. The hamburger toggles expanded or rail, and the choice is remembered. |
| **Page header row**: page title on the left (with a small subtitle such as "On Plex"), **centered sub-tabs** with a gold underline, view controls on the right | Same. Title such as "Movies"; sub-tabs where useful (see §5); right side has a **card-size slider** and a **grid/rows toggle**. |
| **Hub rows**: bold title, small subtitle line, left/right arrows at the top-right of the row, cards with **title + meta under the image** (not overlaid) | Same. Replaces the current overlay-on-hover card text. |
| Two card shapes: **landscape 16:9** (top hubs) and **poster 2:3** | Landscape for "Continue Watching" and the first home hub (backdrop images); poster everywhere else. |
| **Detail page**: no full-bleed hero; background is a **soft gradient tinted from the poster's colours**; poster on the left, metadata on the right; gold primary action + round icon buttons; clamped overview with "More ⌄" | Same. Replaces the current backdrop hero on `/movie/[id]` and `/tv/[id]`. |
| **Seasons as a poster row** ("Season 1 · 7 episodes") | Same. Choosing a season shows its episode list below (replaces the `<details>` dropdown). |
| **Splash** (logo centered on a flat dark background) | A short splash/loading state on a cold load only, never on client navigation. |
| Flat charcoal surfaces (#1f1f1f–#2b2b2b), low contrast borders, gold accent | New tokens (§4). |

## 3. Layout and responsiveness

### 3.1 App shell

```
┌──────────────────────────── top bar (56px) ─────────────────────────────┐
│ ☰  EVOLIX   [ 🔍 Search…                    ]                    (O) ⌄ │
├──────────┬──────────────────────────────────────────────────────────────┤
│ sidebar  │  Page title        Tab · Tab · Tab              ─●─  ▦       │
│ 240px    │  ───────────────────────────────────────────────────────────  │
│ or 64px  │  Row title                                              ‹ ›   │
│ rail     │  subtitle                                                     │
│          │  [card] [card] [card] [card] [card] →                         │
└──────────┴──────────────────────────────────────────────────────────────┘
```

| Breakpoint | Top bar | Sidebar | Content |
|---|---|---|---|
| **< 768px** (phone) | Logo, search icon (opens full-width search sheet), avatar | Hidden; current **bottom tab bar** stays (restyled) | Gutter 16px; rows show ~2.3 poster cards or 1.3 landscape cards so the next one peeks |
| **768–1279px** (tablet / small laptop) | Full pill search | **Rail (64px)** by default; hamburger opens it as an **overlay drawer** with a scrim | Gutter 24px |
| **≥ 1280px** (desktop) | Full | **Expanded (240px)** by default, collapsible to rail; state saved in `localStorage` (wrapped in try/catch) | Gutter 32–40px; cards keep their size and more fit per row (no huge cards at 4K) |

Rules:
- No horizontal page scroll at any width. Only rows scroll sideways (scroll-snap, touch and trackpad friendly).
- Touch targets ≥ 44px. Row arrows appear only on hover-capable pointers (`@media (hover: hover)`); touch uses swipe.
- Respect `env(safe-area-inset-*)` for the top bar and bottom tab bar.
- The sidebar and top bar are hidden on `/watch/*`, which already works through the `NavMarker active="watch"` CSS.

### 3.2 Card sizing (card-size slider)

- A CSS variable `--card-w` drives poster width (landscape width = `--card-w * 1.6`).
- The slider sets 3 to 5 steps (for example 120 / 150 / 180 / 210 px). It is saved per viewer in `localStorage` and applied as a `data-size` attribute on the shell, so there is no layout shift on load. The value is read in a tiny inline script before paint.
- Hidden on phones, where the size is fixed and tuned for the screen.
- **Grid/rows toggle** (Movies, TV, My List): "rows" = hub rows by genre; "grid" = the current paginated grid.

## 4. Visual design tokens

Replace the `.viewer` token block in `viewer.css`. Names stay `--v-*` so existing rules keep working during the migration.

| Token | Value | Use |
|---|---|---|
| `--v-bg` | `#1f1f1f` | page background |
| `--v-bar` | `#141414` | top bar, sidebar (slightly darker than the page) |
| `--v-surface` | `#2a2a2a` | inputs, empty-state boxes, menus |
| `--v-surface-hi` | `#353535` | hover / pressed |
| `--v-fg` | `#ffffff` | primary text |
| `--v-fg-dim` | `#a0a0a0` | subtitles, meta ("2 seasons", year) |
| `--v-fg-faint` | `#6e6e6e` | disabled, tertiary |
| `--v-primary` | `#e5a00d` (gold, kept close to the current `#f5a623`) | active nav, tab underline, primary buttons, focus ring |
| `--v-primary-fg` | `#1a1a1a` | text on gold |
| `--v-border` | `rgb(255 255 255 / .08)` | dividers |
| `--v-radius` | `6px` cards / `999px` pills / `4px` buttons | |
| `--v-tint` | set per detail page (§6.4) | detail background gradient |

Typography:
- One sans family through `next/font/google`, loaded in the viewer layout only. Recommended: **Inter**, or **Noto Sans**, which is closer to the reference. Weights 400 / 500 / 700.
- Scale: page title 20/500, row title 20/700, card title 13/400, card meta 12/400 dim, detail title clamp(28px, 4vw, 40px)/700, body 15/400.
- Card titles truncate to one line with an ellipsis (as in the reference "The Decline of Western …").

Icons: keep `_components/icons.tsx` (1.75–2px stroke, outline style matches the reference). Add Menu, Compass, Grid, Image, Share, Check, More (⋮) and ChevronDown.

## 5. Page-by-page

### 5.1 Home (`/dashboard`)
- **Remove the big auto hero.** The reference has none. Optional: a compact "Featured" landscape row as the first hub.
- Header: title "Home"; centered tabs **Home · Continue Watching · My List** (tabs are links that scroll to or filter hubs; keep it simple: Home = all hubs).
- Hubs in order: Continue Watching (landscape, with a progress bar and "32 min left", data from `continueWatching`), My List, Recently added movies, Recently added shows, one hub per genre. Each hub has a title, a subtitle ("Movies", "TV Shows", "Movies & Shows") and arrows; the title links to "See all".

### 5.2 Movies (`/movies`) and TV Shows (`/tv`)
- Header: title "Movies" with a subtitle "N titles"; tabs **Browse · Genres**; right side shows the slider + grid/rows toggle.
- **Rows mode** (default): "Recently added", then one hub per genre for that kind.
- **Grid mode:** the current `BrowsePage` grid with sort chips moved into a "⋮" menu next to the title (as in the reference), and pagination restyled.
- **Genres tab:** a grid of genre tiles linking to `/search?genre=…`.

### 5.3 My List (`/my-list`)
- Same header pattern; grid by default; empty state uses the `--v-surface` box style from the reference ("There are no locations…").

### 5.4 Search (`/search`)
- Results grid under the same header. The top-bar pill drives the query (existing debounce logic in `nav.tsx` is kept). Genre chips stay as filters.

### 5.5 Title detail (`/movie/[id]`, `/tv/[id]`)
Layout (desktop), following screenshots 6–7:

```
[poster 250px]   Title (bold)
                 [TV-MA] 2008  Drama, Crime, and more
                 ★ 8.9 TMDB
                 [ ▶ Play ]  (🔖) (✓) (⤴)
                 Overview text clamped to 3 lines…
                 More ⌄

Seasons                                           (TV only)
[S1][S2][S3][S4][S5]   ← poster cards, selected one has a gold ring
Episodes · Season 2                               ← episode list for the selected season
Cast  ·  Trailers  ·  Gallery                     ← existing MediaSections, restyled as hub rows
```

- Primary button = **Play** / **Resume S2:E3** (gold); icon buttons = My List toggle (existing `BookmarkButton`), Trailer (scrolls to trailers), Share (Web Share API, falling back to copy link).
- Background: radial/linear gradient from `--v-tint` (top-left) into `--v-bg` (§6.4). The backdrop image is optional and very low opacity (≤ 15%) behind the gradient; the image-toggle icon top-right switches it on or off, as in the reference.
- Season selection uses `?season=N`, as today, so it stays server-rendered and shareable; the poster row replaces `SeasonSelect`.
- Phone: poster above the text, centered at 160px; buttons full-width; season row scrolls sideways.

### 5.6 Account and the auth pages
Account inherits the shell. Login, register and the other auth pages are out of scope for this pass, but should later reuse the tokens for consistency.

### 5.7 Splash
Only on the first hard load of the viewer: logo centered on `--v-bg`, which fades out once the shell hydrates (≤ 600ms, skipped if already hydrated). Never blocks content or shows on client navigation. Reduced motion: no fade.

## 6. Motion and animation

Principles: **fast (150–300ms), eased (`cubic-bezier(.2,.8,.2,1)`), meaningful, interruptible**, and only `transform`/`opacity` (plus `filter` sparingly) so it stays 60fps on phones. Everything is disabled or reduced under `prefers-reduced-motion: reduce`.

Shared tokens in `viewer.css`:
```css
--v-ease: cubic-bezier(.2, .8, .2, 1);
--v-dur-1: 120ms;  /* hover, press */
--v-dur-2: 220ms;  /* panels, tabs */
--v-dur-3: 380ms;  /* page / shared-element */
```

| # | Interaction | Animation | Tech |
|---|---|---|---|
| 6.1 | **Route changes** (sidebar / tab nav) | Content area crossfades with a 8px upward slide; shell (top bar, sidebar) stays still | React `<ViewTransition>` around `{children}` in `app/(viewer)/layout.tsx`; Next navigations are transitions already (see `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`) |
| 6.2 | **Poster → detail poster** | Shared-element morph: the clicked card image flies into the detail poster slot | `<ViewTransition name={"poster-"+id} share="morph" default="none">` on `PosterCard` image and the detail poster |
| 6.3 | **Skeleton → content** (Suspense) | Skeleton exits down/fades, content enters with a slide-up | `<ViewTransition exit/enter>` inside existing `Suspense` fallbacks (`skeletons.tsx`) |
| 6.4 | **Detail tint** | Background gradient fades from neutral to the poster colour (300ms) once the colour is known | CSS transition on a `--v-tint` custom property (registered with `@property` so it interpolates) |
| 6.5 | **Card hover / focus** | Image scale 1.04, slight lift shadow, title turns white→gold; play badge fades in | CSS `transform` transition, hover-capable devices only |
| 6.6 | **Card press** (touch) | Scale 0.97 on `:active` | CSS |
| 6.7 | **Rows entering view** | Stagger fade/slide-up of the first visible cards (40ms step, max 6) once per row | `IntersectionObserver` + a `data-in` attribute, CSS animations; no JS animation library |
| 6.8 | **Row arrows** | Smooth scroll by one viewport of cards; arrows fade in on row hover | `scrollBy({behavior:"smooth"})` (existing `scroll-row.tsx`) |
| 6.9 | **Sidebar expand / collapse** | Width animates 64↔240px, labels fade; drawer on tablet slides in with a scrim fade | CSS `grid-template-columns` transition + `translate` |
| 6.10 | **Sub-tab underline** | Gold underline slides between tabs | A single absolutely positioned bar, or a named `ViewTransition` |
| 6.11 | **Bookmark toggle** | Icon pops (scale 1→1.2→1) and fills; toast "Added to My List" slides up | CSS keyframes; reuse the toast pattern |
| 6.12 | **Season switch** | Episode list crossfades; selected season poster gets the gold ring with a 150ms scale | `<ViewTransition>` keyed by season |
| 6.13 | **Overview "More"** | Height expands smoothly | `interpolate-size: allow-keywords` with a fallback to an instant toggle |
| 6.14 | **Menus** (avatar, ⋮) | Scale from 0.96 + fade, origin at the trigger | CSS, `@starting-style` |

Without browser support for View Transitions the app works normally and simply doesn't animate (React handles this).

## 7. Technical approach

- **Keep plain CSS in `viewer.css`** (current approach, scoped to `.viewer`). Split it into `viewer/tokens.css`, `viewer/shell.css`, `viewer/cards.css`, `viewer/detail.css` and `viewer/motion.css`, imported by the viewer layout, so the file stays manageable. Tailwind stays for admin/auth.
- **No new animation library.** Use React `ViewTransition` + CSS. Framer Motion etc. are not needed.
- **New components** (in `app/(viewer)/_components/`):
  - `app-shell.tsx`: top bar, sidebar, content slot; client island only for the toggle state.
  - `sidebar.tsx`
  - `page-header.tsx`: title, subtitle, tabs, slot for controls.
  - `hub-row.tsx`: replaces `content-row.tsx`; adds subtitle + `variant: "poster" | "landscape"`.
  - `media-card.tsx`: replaces `poster-card.tsx`; adds text under the image + the landscape variant.
  - `detail-header.tsx`: replaces `title-hero.tsx` on detail pages.
  - `season-row.tsx`
  - `card-size-control.tsx`
  - `splash.tsx`
- **Reused as is:** all data loaders (`lib/viewer/*`), `bookmarks.tsx` logic, `scroll-row.tsx` logic, `search-bar` debounce, `NavMarker` active-state mechanism, `proxy.ts` routing, the watch player.
- **Poster tint colour (§6.4):**
  - **v1:** client-side. Draw the w92 poster to a small canvas (`crossOrigin="anonymous"`; TMDB's image CDN sends CORS headers), take an average or dominant colour, darken it to a fixed lightness, and set `--v-tint`. Fallback is neutral `#2a2a2a`.
  - **v2 (optional):** compute it at import time in the admin and store it as `movies.accent_color` / `shows.accent_color`, so it renders on the server with no flash.
- **Images:** landscape cards use `backdropPath` at `w780`; posters at `w342`, plus `srcset` for retina; always `width`/`height` + `loading="lazy"` to avoid layout shift.
- **Accessibility:**
  - Sidebar is a `<nav>` with `aria-current="page"`.
  - Tabs are links, not ARIA tabs, because they change routes.
  - Visible gold focus ring.
  - The slider is a native `<input type="range">` with a label.
  - Contrast ≥ 4.5:1 for `--v-fg-dim` on `--v-bg`.
- **Performance budget:**
  - No layout shift from the shell (sidebar state applied before paint).
  - Hub rows stay server components.
  - Client JS is limited to the shell toggle, slider, tint, row arrows and bookmarks.

## 8. Rollout (suggested order, each step shippable)

1. **Tokens + typography + shell** (top bar, sidebar, bottom bar restyle, page header). All pages get the new frame.
2. **Cards + hub rows** (poster + landscape, text under the image, entrance stagger, hover/press) and the Home page re-layout.
3. **Movies / TV / My List / Search** headers, rows/grid toggle, card-size slider.
4. **Detail page** (detail header, tint, season row, restyled cast/trailers/gallery).
5. **Motion pass:** route `ViewTransition`, poster morph, Suspense reveals, menus, splash.
6. Cleanup: delete the replaced components and CSS (`title-hero`, `poster-card`, `content-row`, `season-select`, `.v-hero*` and others).

## 9. Acceptance criteria

- [ ] At 360, 768, 1024, 1440 and 2560px widths: no horizontal page scroll, nothing overlaps, and the sidebar, rail and bottom bar behave as described in §3.1.
- [ ] Sidebar collapse state and card size persist across reloads with no visible jump.
- [ ] Home shows hubs with titles and subtitles; Continue Watching uses landscape cards with a progress bar.
- [ ] Detail page matches the §5.5 layout, the background tints from the poster within ~300ms, and Play/Resume, My List and Share work.
- [ ] Choosing a season updates `?season=` and animates the episode list.
- [ ] Route changes and poster→detail morph animate in Chromium and Safari, and degrade to instant navigation elsewhere.
- [ ] With `prefers-reduced-motion: reduce` there is no movement beyond opacity.
- [ ] Keyboard only: every control is reachable, the focus ring is visible, and Esc closes the drawer and menus.
- [ ] `pnpm run build` and `pnpm run lint` pass; Lighthouse mobile performance does not regress from today.

## 10. Decisions (grilling session, 2026-10-10)

These override anything above that conflicts with them.

| # | Decision |
|---|---|
| Q1 | Home: no big hero. First row is an automatic **Featured** row of landscape cards. |
| Q2 | Font: **Noto Sans** via `next/font/google`, viewer only. |
| Q3 | Accent: keep **`#f5a623`**. |
| Q4 | Detail tint computed **client-side** from the poster (canvas); DB-stored colour is a later option. |
| Q5 | **No Discover page** in this redesign (separate spec later). |
| Q6 | Phones keep a restyled **bottom tab bar**. |
| Q7 | **Card-size slider + rows/grid toggle**, tablet and desktop only. |
| Q8 | **No splash screen.** |
| Q9 | Account page joins the viewer shell; auth pages are a later pass. |
| Q10 | One branch (`ui-redesign`), one commit per rollout step. |
| Q11 | Featured row: automatic now (newest titles with a backdrop); curated later. |
| Q12 | Movies/TV default to **rows**, My List/Search default to **grid**; the choice is remembered per page. |
| Q13 | **No tabs on Home.** Tabs only where they switch real views (Movies/TV: Browse · Genres). |
| Q14 | Desktop sidebar **expanded** by default, then remembered. |
| Q15 | Plex-style light hover (zoom, outline, play badge, bookmark button); no pop-out preview. |
| Q16 | Detail primary button is **progress-aware**: Resume / Continue SxEy / Play. |
| Q17 | Detail background: tint + **faint backdrop (~15%)**, no toggle. |
| Q18 | Sidebar: Home, Movies, TV Shows, My List. Account/Admin stay in the avatar menu. |
| Q19 | Genres tab uses **image tiles** (backdrop of a top title per genre, one grouped query). |

## 11. Implementation notes

**Styles:** split into `app/(viewer)/styles/`, imported in this order by `app/(viewer)/layout.tsx`:
- `tokens.css`
- `shell.css`
- `cards.css`
- `detail.css`
- `components.css` (the former `viewer.css`)
- `motion.css`

**Preferences:**
- Sidebar state and card size live in localStorage. An inline script in the viewer layout mirrors them onto `<html data-v-sidebar data-v-size>` before first paint.
- The rows/grid choice lives in a cookie (`v-view-<page>`), so the server renders the remembered view. `?view=` overrides it.

**Motion:**
- `_components/motion.tsx`: `PageMotion`, `Reveal`/`SkeletonOut`, `Swap`.
- The poster morph is named on click in `card-link.tsx`, because the same title can appear in several rows at once and duplicate names would cancel the transition.

**Detail tint:** `detail-client.tsx` samples the w92 poster on a canvas. Lightness is pinned to 22% and saturation capped at 55%, so text stays readable.

**Deviations from the plan above:**
- §5.1: Home has no tabs and the hero is replaced by a Featured row (Q1, Q13).
- §5.5: the "image toggle" icon was dropped (Q17). The ratings row shows TMDB only, because no other scores are stored.
- §5.7: no splash screen (Q8).
- §6.10: the tab underline animates in place (scale) rather than sliding between tabs, since tabs are separate routes.
- §6.13: the overview "More" expands instantly; the planned fallback was used.
- Not done in this pass: auth pages restyle (Q9) and DB-stored tint colour (Q4b).
