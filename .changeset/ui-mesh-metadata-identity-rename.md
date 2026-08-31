---
'@selvajs/ui': patch
---

Follow the mesh identity rename: metadata dialogs exclude `id`, not `sourceComponentId`/`originalIndex`

No behavior change for a normal mesh — this only affects what the metadata panel hides, matching
the field `@selvajs/visualization` now stamps on `userData`.
