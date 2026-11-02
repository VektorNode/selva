---
'@selvajs/platform': minor
'@selvajs/server': minor
'@selvajs/solve': minor
'@selvajs/selva': patch
---

Shared helpers for what every host was writing itself.

- `@selvajs/platform`: `walkPages` and `listAll` read a cursor-paged list to its end. One call stops at `MAX_PAGE_LIMIT` without saying so.
- `@selvajs/server`: `createBoundedTtlCache` and `createSessionRefresher` in `/http`, and `isUsableCachedSchema` in `/definitions`. `runHandler` now sends a thrown error's `details.retryAfter` as `Retry-After`.
- `@selvajs/solve`: `SolvePhaseMetrics` carries everything in the `Server-Timing` header (`defLoadMs`, `rhino`, `settle`, `defBytes`), so a host logs the data rather than parsing the header.
- `@selvajs/selva`: requests that arrive together with an expired session share one token exchange. A provider that rotates refresh tokens could otherwise refuse all but the first, which cleared the cookie and signed the user out.
