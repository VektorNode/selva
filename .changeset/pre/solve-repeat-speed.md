---
'@selvajs/solve': patch
---

A solve served from the scheduler's cache reuses its gzipped body instead of serializing and compressing again, so dragging a slider back to a value it already solved costs microseconds. The compressed copy lives as long as the cached result and isn't counted against `COMPUTE_SOLVE_CACHE_MB`.

Responses now gzip at level 1: within 1% of the old size on display output and about 3% on numeric output, in up to a fifth of the time.
