---
'@selvajs/selva': patch
---

Measure response gzip as its own timing phase. Compression now runs before the Server-Timing snapshot and is reported as `gzip` (header + browser log + server debug log), so its cost no longer silently inflates the browser's network-latency estimate.
