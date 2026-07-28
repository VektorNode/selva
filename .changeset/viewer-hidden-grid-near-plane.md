---
'@selvajs/compute': patch
---

Fix edge overlays bleeding through geometry in front of them, by biasing the lines instead of
receding the surfaces.

Edges were kept off their own coplanar surface by pushing every mesh's **surface** backwards with a
slope-scaled `polygonOffset` (factor 1, units 2), leaving the lines at true depth. The slope term
scales with the polygon's dZ/dpixel, which is small head-on but very large on a surface viewed near
edge-on — one pixel then spans a lot of depth. On a grazing face, surfaces receded by far more than
the millimetre-scale gaps between stacked parts, so geometry _behind_ a wall won the depth test
against that wall's own receded surface and its edges drew straight through it.

The bias now lives on the edge material instead, units-only with no slope term, so it is a fixed
number of depth quantization steps regardless of viewing angle: enough to lift an edge off the
surface it was extracted from, never enough to reach across to a neighbouring part.

This also fixes two collateral bugs in the old approach. Surfaces are no longer mutated at all, so
look presets keep the `polygonOffset` their materials ship with (`EMISSIVE`/`METAL`/`CONCRETE` set
factor 1 / units 1, which `addEdges` had been overwriting); and `removeEdges` no longer resets those
to 0/0, which had permanently stripped the preset's offset on an edges on/off toggle.

Depends on the dynamic near-plane fit to stay correct: a constant depth bias is only safe while
depth ULPs stay small, and the fitter is what holds them at micron scale when zoomed out. Which
surfaced a bug there — the fitter clamps `camera.near` by the camera's distance to any ground plane
carrying a visible aid, but its list of planes was captured once at init from whether the aid
_object existed_, not whether it is drawn. The viewer builds its grid up-front so the tools menu can
toggle it, yet starts it hidden, so a grid nobody could see clamped `near` to half the camera's
height above the ground — driving `near` toward zero at grazing views and the depth ULP up with it.
`groundNormals` is now a per-frame callback returning only visible aids.

Separately, the distance fade now measures **edge density** rather than the overlay's bounding
sphere. Edges draw at a constant pixel width, so once neighbouring lines sit under a pixel or two
apart they merge into a dark smear — worst on layered sheet goods, whose millimetre-pitch laminations
are sub-pixel at any zoom that fits a metre-scale part on screen. The old rule scored the bounding
sphere and faded below 80 px, which never fired for exactly those parts, because a large mesh whose
_internal_ detail has collapsed still covers much of the viewport. Overlays now fade on the
15th-percentile segment length scaled to pixels per frame — a quantile, not a mean, because a 1:10000
mix of lamination pitch to silhouette length averages to a value that fades neither correctly.

Note for callers constructing `createNearPlaneFitter` directly: `groundNormals` changed from
`THREE.Vector3[]` to `() => THREE.Vector3[]`. This module is not part of the package's public
surface — `initThree` is the supported entry point and is unaffected.
