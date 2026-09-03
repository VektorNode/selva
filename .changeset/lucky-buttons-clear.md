---
'@selvajs/solve': minor
'@selvajs/selva': minor
---

Add Clear buttons for Selva's own solve and definition caches in `/admin/compute`

The per-server **Purge** button POSTs to Rhino.Compute's `cache/purge`, which clears that server's
`cachesolve` and nothing else. Selva's in-process solve cache sits in front of it, so a purge alone
never produced a fresh solve — the only way to drop those results was to restart the process.

Both cache panels under **Caching** now have a **Clear** button, behind a confirm dialog, reporting
the entries and bytes dropped. They clear only the instance serving the request: behind a load
balancer the others keep theirs, so a fleet-wide clear still means a restart.

Neither is destructive. Clearing the solve cache costs a re-solve, clearing the definition cache
costs a storage re-read; version ids are immutable, so no cached entry can go stale on its own.
Reach for them when a definition reads a live URL, a database, or the clock, or after upgrading
Rhino in place on an existing compute server.

`SolveEngine` gains `clearDefinitionCache()`, alongside the existing `clearSolveCaches()`.
