---
'@selvajs/visualization': patch
---

`parseMeshBatchBlob` and the other mesh-batch entry points throw `VisualizationError` for every corrupt blob, as documented. An out-of-range index in a batch large enough to assemble off the synchronous path threw a plain `Error`, and blob metadata that was not an object, or whose `groups`, `materials` or meshes had the wrong shape, threw a `TypeError` (or parsed to an empty scene).
