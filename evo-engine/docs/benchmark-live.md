# Extraction benchmark (live)

Run 2026-10-25 09:01 on Evo-Engine Media Service; 4 jobs per scenario, one at a time. Real providers, TMDB ids 680, 603.

RAM and CPU cover the engine process tree (Python + Playwright driver + Chromium).

## Browser pool and asset blocking

| Scenario | Jobs | Time s (median / p95) | Peak RAM MB (median / p95) | CPU s (median / p95) | Browser launches |
|---|---|---|---|---|---|
| Before: fresh browser per job, nothing blocked | 4 | 8.57 / 9.62 | 1109 / 1122 | 6.33 / 6.89 | 4 |
| After: pool + blocking + decryptor cache | 4 | 7.77 / 9.55 | 1000 / 1021 | 4.76 / 5.68 | 1 |
