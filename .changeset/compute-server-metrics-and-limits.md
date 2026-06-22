---
'@selvajs/selva': minor
---

Surface more compute server info and make upload/solve limits visible and legible.

- **Admin → Compute**: each reachable server now shows live **active children** (read passively — never spawns children, so an idle pool reads as 0) and **idle time** (seconds since the last child request), alongside the existing version/plugin tiles.
- **Admin → System**: new read-only panel listing the resolved compute/upload limits (max solve duration, rate limits, file-size caps, request/response byte caps, remote-definition fetch limits, cache TTL) so operators can see what's enforced without reading `.env`.
- **Definition upload**: oversized `.gh` uploads now fail with a clear "file too large" message. A new pre-read body-size guard returns the app's JSON error envelope instead of letting an opaque non-JSON 413 from adapter-node/proxy surface as a misleading "Compute server error".
- **Fix**: server-side env-driven config (`MAX_SOLVE_DURATION_MS`, rate-limit, file-size caps, `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`, `ALLOW_INSECURE_COOKIES`) now reads via SvelteKit's `$env/dynamic/private` instead of bare `process.env`. Under `vite dev`, Vite never mirrors `.env` into `process.env`, so every `.env` override was silently ignored in development and the hard-coded defaults were used regardless. An ESLint rule (`no-restricted-properties`) now warns on bare `process.env` in selva server code to prevent regressions; legit OS-level reads (`NODE_ENV`/`PATH`/`HOME`) opt out with a documented inline disable.
- **Admin → System**: the "Compute rate limit" row now lists both env keys that drive it (`COMPUTE_RATE_LIMIT_MAX` and `COMPUTE_RATE_LIMIT_WINDOW_MS`) — previously the window var was invisible, so operators couldn't tell how to change the "/ 1.7 min" window.
