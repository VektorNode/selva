---
'@selvajs/solve': minor
'@selvajs/selva': minor
---

Long solves no longer depend on proxy timeouts. The solve routes take `Prefer: respond-async`: they answer `202` with a solve id at once, and `GET /api/v1/solves/{id}?wait=25` long-polls for the result (`DELETE` cancels it). A solve nobody polls for 60 s is cancelled. The web app solves this way. `createComputeFetchSolveFn` takes `respondAsync`, and `@selvajs/solve/server` exports `AsyncSolveStore` and `wantsAsync`. Selva now waits 60 s past the Compute server's timeout instead of 5 s, so Compute ends a solve, not Selva.
