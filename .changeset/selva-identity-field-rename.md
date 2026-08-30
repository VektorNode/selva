---
'@selvajs/selva': patch
---

Follow the mesh identity rename and @selvajs/visualization's parse-layer rename

`packages/selva/e2e/helpers/fake-compute.ts` and the library viewer route now use `id` instead of
`sourceComponentId`/`originalIndex`, and call the renamed `getThreeObjectsFromComputeResponse`. No
behavior change.
