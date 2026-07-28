---
'@selvajs/compute': minor
---

Fix the viewer's view presets, which showed the wrong side of the model, and route every
orientation default through a single scene-up basis.

`buildViewDirections` derived its ground-plane axes with the opposite handedness to Rhino's, so in
the default Z-up scene **Front framed the back of the model and Left framed the right**. The
nav-cube inherited the same error. Presets now follow Rhino's convention: Front looks along +Y
(camera at -Y) and Right looks along -X (camera at +X).

**Top and Bottom were also wrong, for a separate reason.** At a pole the view direction is parallel
to `camera.up`, so `up` cannot define the view's roll — the ~0.5° off-pole nudge that avoids the
OrbitControls singularity decides it instead, and it was leaning toward `+forward`. Both pole views
came out rolled, with geometry and text mirrored on screen.

Both poles now lean toward `-forward`, reproducing Rhino's convention exactly: Top is `+X` right /
`+Y` up and unmirrored; Bottom is `+X` right / `+Y` down. Bottom being mirrored is correct — it is
the far side of the model, and Rhino mirrors it too — but it must mirror about the horizontal axis.
Mirroring about the vertical instead (`+X` left / `+Y` up) is the same image rolled 180°, which
still reads as wrong on screen while satisfying a naive "is it mirrored?" check.

The existing test only asserted that "front" was orthogonal to the up axis, which a 180° swap
satisfies — the presets are now pinned to the actual side the camera sits on, and the pole views are
additionally pinned by their on-screen axes and handedness rather than direction alone.

A new `up-axis` module (`buildUpBasis`, `isoOffset`, `sunOffset`, `upToAxis`, exported from
`@selvajs/compute/visualization`) is the single source of truth for the scene basis. Several
defaults previously hardcoded a Z-up vector while _bypassing_ the configured `sceneUp`, so a scene
configured Y-up got a below-horizon camera and a near-horizontal sun even though the presets, floor,
and grid correctly followed `sceneUp`. Now derived from it:

- the default iso camera position (`applyDefaults`)
- the default sun position
- `updateScene`'s first-frame framing — previously a hardcoded `(0.8, 1.0, 1.2)` offset that also
  disagreed with the configured iso default, so the first solve jumped to a different angle than the
  one the viewer opened at
- the near-plane fitter's grid ground-normal fallback

Z-up scenes — every current deployment — keep their existing camera distance and sun placement;
these are behaviour-preserving there and only change non-default `sceneUp` scenes.

## Breaking: `allowAutoPosition` now defaults to `false`

`getThreeMeshesFromComputeResponse` used to drop geometry onto the ground plane by default, but the
WebSocket preview path never did — so the same definition rendered at a different height depending
on transport. Both now keep Rhino's coordinates: the viewer agrees with the Grasshopper definition,
and bounds/measured/picked positions correspond to the real model.

**Migration:** pass `allowAutoPosition: true` to restore the old behaviour.

`MeshExtractionOptions` also gains `groundAxis` (default `'z'`) so that grounding, when enabled,
drops content along the scene's up axis instead of always subtracting `min.z`.

## HDR environment orientation

`scene.environmentRotation` and `scene.backgroundRotation` are now set from `sceneUp`. Three's
equirectangular mapping assumes a Y-up horizon, so in the Z-up scene the environment was lying on
its side — the horizon ran vertically and image-based lighting arrived from +Y rather than from
overhead. Invisible on a neutral studio HDR, obvious on any HDR with a sky/ground split. Exposed as
`environmentRotationFor`.

Also corrects stale docs that contradicted the code: the grid `plane` default (documented `'y'`,
actually `'z'`), the camera controller's `up` ("Defaults to Y-up" — the caller always passes Z), a
`batch-parser` comment describing a Z-up→Y-up rotation that no longer happens, and the previously
undocumented `sceneUp` default.
