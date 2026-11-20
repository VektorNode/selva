---
'@selvajs/solve': patch
---

A solve the Compute server stops at its own time limit (its `504`) now reads as a timeout that names `RHINO_COMPUTE_TIMEOUT`, not as "Compute server is unreachable".
