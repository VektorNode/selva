---
'@selvajs/compute': patch
---

Fix edge overlays bleeding through solid geometry when zoomed or orbited out — a hidden grid was
silently destroying the viewer's depth precision.

The near-plane fitter raises `camera.near` toward the camera↔content gap to recover depth precision,
since a depth ULP grows as `1/near`. It also clamps `near` by the camera's perpendicular distance to
any ground plane carrying an always-visible aid (grid, floor), so that aid can't be clipped at
grazing views.

That list of ground planes was captured **once at init, from whether the aid object existed** — not
from whether it is actually drawn. The viewer builds its grid up-front so the tools menu can toggle
it, but starts it hidden, so the clamp applied permanently to a grid nobody could see. Because the
clamp is half the camera's _height above the plane_, orbiting toward a horizontal view drove `near`
toward zero and the depth ULP up with it. Thin coplanar-ish detail — sheet-goods laminations, layered
panels — then fell inside a single ULP, and hidden edges won the depth test and drew straight through
the surfaces in front of them.

`groundNormals` is now a callback resolved per frame that returns only the planes whose aid is
currently visible, so a hidden grid or floor constrains nothing and toggling one re-applies its
clamp on the next frame with no re-init. In the regression test's geometry this lifts `near` from 1
to 20 — a 20× depth-precision gain; in a typical zoomed-out scene it un-pins `near` from the camera
height entirely.

Note for callers constructing `createNearPlaneFitter` directly: `groundNormals` changed from
`THREE.Vector3[]` to `() => THREE.Vector3[]`. This module is not part of the package's public
surface — `initThree` is the supported entry point and is unaffected.
