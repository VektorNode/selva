---
'@selvajs/selva': patch
---

The admin, setup, login and OAuth pages refuse framing for a percent-encoded path too. The check matched the raw URL while SvelteKit routes on the decoded one, so `/%61dmin/...` rendered the admin pages without `X-Frame-Options`.
