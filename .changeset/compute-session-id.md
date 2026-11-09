---
'@selvajs/compute': minor
'@selvajs/solve': minor
'@selvajs/server': patch
'@selvajs/selva': patch
---

A signed-in user's solves of a stored definition carry `X-Session-Id`, so a compute server running the VektorNode fork's session affinity sends them back to the child holding that user's warm document. The id is an HMAC of the user and definition under `SELVA_HMAC_KEY`; share-link and remote-URL solves send none, and other servers ignore it. From a browser, the server must allow `X-Session-Id` in CORS. `ComputeConfig`, `SolveOptions` and `SchedulerSolveOptions` gain `sessionId`, which throws `INVALID_CONFIG` unless it is 1 to 128 characters from `!` to `~`, before the solve queues or loads its definition; `SolveEngineSolveArgs` gains `sessionId`. None of the caches key on it. `ServerTiming` gains `affinity`, the fork's routing outcome (`hit`, `claimed`, `spilled`, `none`), which Selva forwards as `rhino_affinity` and prints in its compute debug log.

`SolveOptions` and `SchedulerSolveOptions` gain per-solve `headers`, which replace a client config header of any casing. Selva sends `X-Selva-Definition` with each solve, so a warm client no longer stamps every solve with the first definition it served. `SolveEngine.getClient` and `ClientCache.getClient` drop their `definitionGuid` option, and `getIO` requests no longer carry the header.
