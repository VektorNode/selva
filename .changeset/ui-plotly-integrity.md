---
'@selvajs/ui': patch
---

Charts load Plotly with a Subresource Integrity hash, so a changed file on the CDN is refused instead of run. `loadScript` takes an `integrity` option.
