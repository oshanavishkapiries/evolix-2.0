# Extraction benchmark (synthetic)

Run 2026-10-25 08:28 on Evo-Engine Media Service; 8 jobs per scenario, one at a time. Synthetic: a local page with 40 x 150 kB images plus a playlist request, so the numbers show the cost of browser launch and asset loading, not of any provider.

RAM and CPU cover the engine process tree (Python + Playwright driver + Chromium).

## Browser pool and asset blocking

| Scenario | Jobs | Time s (median / p95) | Peak RAM MB (median / p95) | CPU s (median / p95) | Browser launches |
|---|---|---|---|---|---|
| Before: fresh browser per job, nothing blocked | 8 | 1.09 / 1.28 | 617 / 622 | 1.19 / 1.44 | 8 |
| Pooled browser, nothing blocked | 8 | 0.68 / 0.73 | 639 / 644 | 0.47 / 0.50 | 0 |
| Pooled browser + asset blocking | 8 | 0.48 / 0.56 | 631 / 641 | 0.32 / 0.33 | 0 |

## Several qualities of one title

| Scenario | Jobs | Time s (median / p95) | Peak RAM MB (median / p95) | CPU s (median / p95) | Browser launches |
|---|---|---|---|---|---|
| Before: every quality extracts again (3 quality requests per title) | 4 | 3.68 / 5.02 | 629 / 630 | 3.79 / 3.99 | 4 |
| After: later qualities reuse the extraction (+ pool, blocking) (3 quality requests per title) | 4 | 0.49 / 1.34 | 621 / 625 | 0.32 / 1.18 | 1 |
