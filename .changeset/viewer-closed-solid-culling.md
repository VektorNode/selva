---
'@selvajs/visualization': minor
---

Fix z-fighting on thin closed parts (sheet metal, hems) up close. Meshes detected as closed, outward-facing solids now cull their back faces, and the dynamic near plane fits to the nearest geometry in view instead of the whole scene's bounding sphere. Surfaces' slope-based polygon offset is halved, so parts just behind a surface seen at a grazing angle no longer show through it from about 2 m away.

`cullBackfaces: true` now forces `FrontSide` on every mesh; left off, only detected closed solids are culled. `LookMaterialOverride` takes an optional `side`, which the x-ray and wireframe looks set to `DoubleSide` so culled solids still show their far side.
