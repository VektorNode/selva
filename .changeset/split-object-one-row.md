---
'@selvajs/visualization': patch
'@selvajs/ui': patch
---

Meshes that share a writer-minted id on one layer are one object: one outliner row (`SceneEntry.parts`), hidden, hovered, selected, clicked and framed together. A writer uses this for one object drawn in two materials. `setHover` also takes a list of targets.
