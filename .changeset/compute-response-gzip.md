---
'@selvajs/selva': patch
---

Gzip `/api/compute` solve responses when the client accepts it. Solve results are large geometry JSON and were previously sent uncompressed; the response is now streamed through gzip (with `Vary: Accept-Encoding`, skipped for clients without gzip support), typically shrinking the payload several-fold — a near-proportional download speedup on byte-throttled links such as reverse-proxy tunnels. With `SELVA_FLAG_COMPUTE_DEBUG` the server logs the compression ratio per solve, and warns when a fronting proxy strips `Accept-Encoding` (making end-to-end compression impossible). Also includes the debug-gated `/api/diag/throughput` endpoint for isolating slow transport segments.
