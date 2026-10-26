---
'@selvajs/visualization': patch
---

The closed-solid check welds each vertex once per member instead of once per corner, so a vertex can no longer weld to two different neighbours and make a closed part read as open. It is also faster on large meshes. A mesh batch is read once even when the worker declines it; the worker now gets copies of the UVs and colours, so the main-thread fallback still has them if the worker fails.
