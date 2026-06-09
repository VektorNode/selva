---
'@selvajs/ui': patch
---

Scene manager now labels line geometry as "Curve" instead of the internal Three.js class name
(`Line2`/`LineSegments2`), which read as a 2D type. The relabel applies to both the object label
fallback and the type column.
