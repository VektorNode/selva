---
'@selvajs/selva': patch
---

Improve forward-auth diagnostics on the login page.

- If a user is already authenticated (cookie session OR forward-auth headers) when they land on `/login`, they're now redirected to `?redirectTo=` or `/library` instead of seeing the confusing "your proxy didn't forward the identity headers" fallback message that was rendered even when forward-auth was working correctly.
- The header-auth provider now emits a one-shot `[HeaderAuth]` warning on the first request that arrives with none of the configured `SELVA-*` identity headers, naming the expected headers and pointing operators at the README. A second one-shot warning fires when `/login` is hit and proxy identification fails, distinguishing "no headers arrived at all" (proxy bypassed or misconfigured) from "headers arrived but UPN missing or user not allowlisted". Throttled per-process so anonymous traffic doesn't spam the logs.
