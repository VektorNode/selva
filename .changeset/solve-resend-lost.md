---
'@selvajs/solve': patch
'@selvajs/selva': patch
---

`createComputeFetchSolveFn` sends a detached solve once more when a poll finds the server no longer knows it, as after a restart or an update. Before, the page showed "Compute error (HTTP 404)".
