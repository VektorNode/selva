---
'@selvajs/header-auth-provider': patch
---

Remove the temporary forward-auth debug instrumentation now that header-auth deployments have stabilized.

Dropped the per-request `[HeaderAuth][debug]` header dumps inside `identifyFromHeaders` and removed the `dumpHeaders` / `snapshotHeaders` exports. The one-shot `[HeaderAuth]` operator warnings (missing identity headers) are kept.
