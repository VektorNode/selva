---
'@selvajs/cli': patch
'@selvajs/selva': patch
---

`selva update` and `selva doctor` now catch a database that is behind the app. Before, `selva update` moved `@selvajs/selva` past the installed `@selvajs/supabase-provider`, the package that carries the migration SQL, and doctor compared the database only against that stale provider. Both reported success while `/api/health` returned 503 and saves that needed the new schema failed.

- `@selvajs/selva` writes `build/runtime-meta.json` with the migration head it expects, and doctor checks the database against that.
- `selva update` installs the provider on the runtime's channel, polls `/api/health` after the restart, and exits non-zero with the cause and the migration commands when the app comes up degraded.
