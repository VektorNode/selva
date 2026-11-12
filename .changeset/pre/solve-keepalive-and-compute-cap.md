---
'@selvajs/solve': minor
'@selvajs/selva': patch
---

A solve from the web app no longer depends on the reverse proxy's read timeout. With `keepalive: true`, `createComputeFetchSolveFn` sends `Prefer: selva-keepalive`, and `/api/v1/compute` answers 200 at once, holds the connection with a space every 15 s, then sends the real status, headers and body inside it. `@selvajs/solve/server` gains `wantsKeepalive` and `respondWithKeepalive` for other hosts. A server without support ignores the header.

Selva's solve request cap now follows the compute servers: the largest `RHINO_COMPUTE_MAX_REQUEST_SIZE` a reached server reports, 256 MB before one is reached. `SolveEngine.largestReportedRequestBytes()` exposes it. `BODY_SIZE_LIMIT` must be at least that; `/admin/system` warns when it is lower.
