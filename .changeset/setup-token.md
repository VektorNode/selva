---
'@selvajs/selva': minor
'@selvajs/cli': minor
'@selvajs/platform': minor
---

The `/setup` password form now needs the setup link. `npx selva setup-url` prints it on the server, and the scaffold prints it at the end; the link carries a token derived from `SELVA_HMAC_KEY` and stops working once an admin exists. Before, the form accepted any visitor on an unpinned instance, and on a pinned one it accepted whoever typed `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`, which the page itself served. **Scripted first-run setups must post the token** (`token` form field). The page no longer serves the pinned email outside proxy-only auth, and two setups posted together now mint one admin. `@selvajs/platform/config` gains `setupToken`, `isSetupToken` and `setupUrl`.

**OAuth, email-link and proxy sign-ins need the setup link too when `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is unset.** Before, the first of them to arrive became instance admin on a single-tenant instance. Now an unpinned instance goes only to a sign-in from a browser that opened the setup link, which `/setup` remembers in a cookie for an hour, so an email link has to be opened in that browser. The same holds multi-tenant, where an unpinned instance could not be claimed at all before. A pinned email works as before. **Unpinned OAuth or proxy installs must open `npx selva setup-url` before the first sign-in.**
