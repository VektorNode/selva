---
'@selvajs/schemas': patch
---

The schema generators refuse a `schemaVersion` lower than the base ref's, and compare versions numerically, so `2.10.0` counts as a bump over `2.9.0`.
