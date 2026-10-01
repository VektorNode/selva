---
'@selvajs/visualization': patch
---

Fix z-fighting on thin closed parts (sheet metal, hems) up close. Meshes detected as closed, outward-facing solids now cull their back faces, and the dynamic near plane fits to the nearest geometry in view instead of the whole scene's bounding sphere.
