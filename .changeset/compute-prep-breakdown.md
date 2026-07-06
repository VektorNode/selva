---
'@selvajs/selva': patch
---

Break the solve route's pre-solve "load" phase into named sub-steps (body parse, share-token resolve, definition/project/version DB reads, access check, blob fetch, compute-server resolve, schema backfill, client init). Each step's duration is exposed as a `p_*` entry on the `Server-Timing` header and printed as a `prep:` line in the browser solve log, so an intermittent multi-second load spike names the exact step responsible instead of one opaque number.
