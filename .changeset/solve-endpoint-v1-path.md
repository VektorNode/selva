---
'@selvajs/selva': patch
'@selvajs/server': patch
---

Fix the library app page solving against a route that no longer exists.

The `/api/v1` restructure moved `POST /api/compute` to `POST /api/v1/compute`, but
`routes/library/[guid]/+page.svelte` still pointed at the old path. Every solve on a
published definition failed with a 404 whose body was SvelteKit's HTML error page, so the
client reported `non-JSON error body (HTTP 404)` rather than a usable message.

The path escaped the rename because it is passed as an `endpoint` string to
`createComputeFetchSolveFn` instead of appearing as a literal `fetch('/api/...')` call —
worth knowing before the next route move, since a grep for fetch sites will miss it again.

The definition-upload assertion in the `core-loop` E2E had the same stale path
(`/api/definitions`). It waited on a response that could never arrive, so a broken upload
would surface as a timeout instead of a failed assertion.

Comment-only corrections to paths the restructure invalidated: the three limit fields in
`@selvajs/server`'s `compute/limits.ts` (`/api/compute` → `/api/v1/compute`), the
`orgDefaults` pointer in `/api/admin/compute` (`/api/org/compute` →
`/api/v1/orgs/[orgId]/compute`), and the PATCH reference in the team-members page.
