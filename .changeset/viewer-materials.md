---
'@selvajs/visualization': minor
---

Metals keep their reflection in every look. A look's `envMapIntensity` now dims fill only: a material's value blends toward 1 by its metalness, so a metal under `technical` reflects as it does under `showcase`. The automatic satin clearcoat on metals is gone, so bare metal no longer reads lacquered; set `clearcoat` on the wire material to get a coat back. Saved metal materials render differently after this change.

Meshes with UVs get a `tangent` attribute built from them, so anisotropy and normal maps no longer use noisy screen-space derivatives, and stay finite where U or V is constant.

Wire materials take optional `mapSize` (mm one texture repeat covers; maps then use `RepeatWrapping`), `finish` (`'brushed'` or `'rolled'`: procedural roughness streaks along the grain, faded out below pixel size), `transmission` and `ior` (glass).
