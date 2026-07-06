---
'@selvajs/selva': patch
---

Add a debug-gated `/api/diag/throughput` endpoint (requires `SELVA_FLAG_COMPUTE_DEBUG` + a logged-in user) that streams incompressible random bytes through the same transport stack as solve responses. Measuring its MB/s from different vantage points (localhost against Node directly, through the reverse proxy, from the client) isolates which segment makes large solve downloads slow — app, proxy, or network.
