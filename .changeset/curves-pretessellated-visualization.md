---
'@selvajs/visualization': major
---

Curves arrive pre-tessellated. rhino3dm is gone from this package entirely — no dependency, no
optional decode path, nothing in the browser that reads Rhino geometry.

`DisplayCurve.points` (flat `[x,y,z, …]`, Rhino's Z-up frame) is now **required**, and
`DisplayCurve.json` is deleted. The plugin tessellates; `items/curves.ts` builds the `Line2`
straight from the result.

**Removed — all of these were the rhino3dm fallback:**

- `MeshExtractionOptions.rhino` and `MeshExtractionOptions.loadRhino`
- `DisplayItemParseOptions` in its entirety — `parseDisplayItems(items)` now takes one argument
- `DisplayCurve.json`

```diff
-getThreeMeshesFromComputeResponse(response, { rhino: await loadRhino() })
+getThreeMeshesFromComputeResponse(response)

-parseDisplayItems(items, { rhino })
+parseDisplayItems(items)
```

**A curve without `points` now throws `VisualizationError` instead of rendering.** It means the
definition was solved by a Display component predating backend tessellation, and the message says
so — upgrade it in Grasshopper (Solution → Upgrade obsolete components) and re-save. Skipping was
the wrong call: a scene quietly missing its curves is indistinguishable from a definition that has
none, so the failure had to be loud enough to act on. The throw aborts the batch; every other
unrenderable item is still logged and skipped.
