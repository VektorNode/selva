---
'@selvajs/visualization': minor
---

Add merged-mesh picking, lineart/wireframe looks, and fix material state leaking between looks

Merging by material collapses thousands of source objects into a handful of `THREE.Mesh`
instances, which is what keeps an IFC-scale model renderable — the cost was that a raycast could
only ever name the merged mesh, not the individual wall or panel under the cursor. Each merged
mesh now carries its members' index-buffer windows in `userData.members`, so a raycast hit
resolves face → index range → member: selection and the metadata panel report the one object
clicked, even though rendering is still per-material-group.

Two new look presets, lineart (edges only) and wireframe (mesh-as-wireframe, no shading), join
the existing shaded/hidden-line/x-ray set. The outliner gains layers and per-member visibility as
first-class entry kinds, so a scene's structure survives past top-level objects.

Switching looks used to mutate material properties in place, so a look's changes bled into
whatever look came next — a red x-ray highlight could survive a switch back to shaded. Applying a
look now snapshots and restores each material's original properties first.
