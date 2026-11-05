---
'@selvajs/ui': patch
---

Chart outputs render with Plotly.js 4.1.2. Plotly 4's "Share chart" button, which uploads the figure to Plotly's cloud, is turned off. Figures made for Plotly 3 keep their look: scatter-matrix panels stay unlinked, removed `*mapbox` map traces become their `*map` replacements, and colours Plotly 4 rejects (hex without `#`, `hsv()`) are rewritten.

Charts also use Selva's chart palette and font where the figure doesn't set its own, and animated figures (with `frames`) play.
