---
'@selvajs/visualization': minor
---

Measure tool: meshes are picked through a BVH, so hovering stays responsive on large models. Hidden objects and hidden merged members are no longer pickable, the line/point grab band follows the orbit target instead of the world origin, and on-demand rendering now repaints the hover preview. A rubber band with a live readout follows the cursor after the first click, the hover marker shows whether it snapped to a vertex, fat curves snap to their segment endpoints, measurements persist until Escape, and labels no longer switch to exponent notation above 999 units. Adds `MeasureTool.cancel()` and the `three-mesh-bvh` dependency.
