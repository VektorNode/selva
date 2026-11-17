---
'@selvajs/solve': minor
---

`createComputeFetchSolveFn` throws `SolveRequestError` (exported from `@selvajs/solve/client`) when the server refuses a solve, carrying `status`, the parsed `body`, its `code` (or `reason`) and `retryAfterSeconds`. `message` is unchanged.
