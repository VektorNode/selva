---
'@selvajs/selva': patch
---

Redirect `/login` to `/setup` on a deployment that has no instance admin yet.

`/setup` already redirected to `/login` once an admin existed, but not the reverse — and `/login` is on the public-route allowlist, so the first-run redirect in `hooks.server.ts` skipped it. A fresh deployment therefore served a fully rendered login form on which every credential failed with "Invalid credentials", and the only way to reach the bootstrap flow was guessing the `/setup` URL. The landing page's own "Sign in" link pointed straight at it.

The gate keys on `hasInstanceAdmin` rather than user count, matching what `/setup` uses — an OIDC provider that can't enumerate users still answers it. The form action carries the same check, so a stale or direct POST redirects instead of spending a rate-limit slot on a password that cannot exist yet.
