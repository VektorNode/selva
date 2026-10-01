---
'@selvajs/visualization': minor
---

Metals reflect a soft studio room instead of the scene HDR. The HDR's hard horizon over a near-black ground made a metal face split into a blown-out white band and a black one, jagged wherever roughness varied. Non-metals keep the HDR, so the looks don't change for them. The studio probe is each metal material's own `envMap`, which also makes three honour the material's `envMapIntensity` (a wire material's own value, else the look's blended toward 1 by metalness); with only `scene.environment`, three overwrites `envMapIntensity` with `scene.environmentIntensity` on every draw. The automatic satin clearcoat on metals is gone; set `clearcoat` on the wire material to get a coat back. Saved metal materials render differently after this change.

Meshes with UVs get a `tangent` attribute built from them, so anisotropy and normal maps no longer use noisy screen-space derivatives, and stay finite where U or V is constant.

Wire materials take optional `mapSize` (mm one texture repeat covers; maps then use `RepeatWrapping`), `finish` (`'brushed'` or `'rolled'`: procedural fibres of varied length along the grain, in roughness and brightness, faded out before they reach pixel size), `transmission` and `ior` (glass).
