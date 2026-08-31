---
'@selvajs/ui': minor
---

Wire up merged-mesh picking, the new looks, and outliner expand/collapse-all

`Viewer.svelte` and `SceneManager.svelte` pick up the per-member selection from
`@selvajs/visualization`'s merged picking — clicking into a merged mesh now reports the one part
under the cursor, not the whole group, in both the highlight and the metadata dialog. The look
picker gains Line Art alongside the existing styles, with readable labels for the ones that don't
title-case cleanly (`xray` → "X-Ray"). Sunlight, shadows and ambient occlusion are on by default
now (previously off for this app specifically) — a look's own settings carry them, and IBL alone
made a box read as a flat white silhouette. The outliner's "Expand all" / "Collapse all" join the
existing per-layer expand/collapse. The 2D/3D camera toggle is relabelled "Orthographic camera" /
"Perspective camera" to say what it actually switches.
