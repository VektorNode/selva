---
'@selvajs/selva': patch
---

The definition viewer no longer loads the rhino3dm WASM module, and the dependency is gone from the
app entirely.

Curves now arrive pre-tessellated from the plugin, so the 2.5 MB module is never fetched — the
viewer's first paint gets faster on every solve that renders geometry.

**A definition solved by an outdated Display component now fails instead of rendering.** Curves
from a pre-tessellation plugin carry no `points`, and the viewer surfaces an error naming the item
rather than drawing a scene silently missing its curves. The fix is to open the definition in
Grasshopper, run Solution → Upgrade obsolete components, and re-save.
