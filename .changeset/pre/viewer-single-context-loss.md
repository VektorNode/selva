---
'@selvajs/ui': patch
---

Closing a `Viewer` no longer logs "WebGL: INVALID_OPERATION: loseContext: context already lost". It released its WebGL context a second time after `dispose()` had already done so.
