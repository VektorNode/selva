---
'@selvajs/solve': minor
'@selvajs/platform': minor
'@selvajs/server': patch
---

A solve's deadline, request cap and definition-cache reuse come from what its compute server reports, not from Selva's env.

- `@selvajs/solve`: `SolveEngine`'s limits no longer take `solveDeadlineMs` or `computeReuseDefinitionCache`. Each server's `SolveLimits` is on the client `getClient(server)` returns; a server that reports nothing gets `DEFAULT_SOLVE_DEADLINE_MS` (100 s). `DEFAULT_SOLVE_DEADLINE_MS` and `MAX_SOLVE_DEADLINE_MS` are exported.
- `@selvajs/platform`: `COMPUTE_TIMEOUT_DEFAULT_MS`, `COMPUTE_TIMEOUT_MIN_MS`, `COMPUTE_TIMEOUT_MAX_MS`, `COMPUTE_RETRY_MAX`, `clampTimeoutMs` and `clampRetryCount` are removed.
- `@selvajs/server`: 2.0.0-beta.25 already dropped `ComputeLimits.solveDeadlineMs` and `computeReuseDefinitionCache` without saying so, and cannot run with `@selvajs/solve` 2.0.0-beta.12 or older: `new SolveEngine` throws on the missing deadline. Use it with this `@selvajs/solve` release. `COMPUTE_SOLVE_DEADLINE_MS` is no longer read, and the request cap is the fixed `COMPUTE_REQUEST_MAX_BYTES` (256 MB).
