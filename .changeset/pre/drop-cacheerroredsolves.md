---
'@selvajs/compute': major
'@selvajs/solve': patch
'@selvajs/server': minor
---

Removed the `cacheerroredsolves` request option and the `COMPUTE_CACHE_ERRORED_SOLVES` setting. Only the VektorNode Rhino.Compute fork honored the flag, and the fork dropped it to stay closer to McNeel's server, which never caches an errored solve. Selva's own solve cache still keeps errored solves by default (`cache.cacheErroredSolves` on the scheduler).

The scheduler's solve cache no longer stores a solve the Selva plugin aborted (`selva.outcome.aborted`): it stopped partway, so the same inputs solve again instead of replaying a partial result.
