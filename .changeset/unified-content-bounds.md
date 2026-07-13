---
'@selvajs/compute': patch
---

Unify the three near-duplicate scene content-bounds helpers into one `computeContentBounds` in `three-helpers.ts`.

- Removed the private `computeContentBox` (camera-controller) and the private `computeContentBounds` (three-initializer), plus two duplicated copies of `isViewerAid` / `VIEWER_AID_IDS`. Fit-to-view, shadow-frustum fitting, pick-threshold scaling, and preset-view framing (`setView`) now all measure the same box through the single shared function — no behavioral change, no drift risk.
- The canonical helper refreshes world matrices once up front (`scene.updateMatrixWorld(true)`) so `expandByObject` reads current transforms regardless of which caller invokes it.
