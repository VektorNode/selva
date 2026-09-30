---
'@selvajs/visualization': minor
---

Wire materials take optional `envMapIntensity`, `clearcoat`, `clearcoatRoughness`, `anisotropy`, `anisotropyRotation`, `roughnessMap` and `normalMap`. A material's own `envMapIntensity` wins over the look's, and `setLook` keeps it except in looks with a `materialOverride`. An explicit `clearcoat` replaces the automatic satin coat on metals. Anisotropy applies only when the batch carries UVs. SLVM `slvm:tex:N` references resolve in all three texture slots.
