---
'@selvajs/solve': patch
'@selvajs/ui': patch
---

In manual-solve mode, `setValue` with the value the session already holds no longer marks the result stale. `NumberInput` no longer commits a typed value twice.
