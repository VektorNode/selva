---
'@selvajs/selva': patch
---

Prep the render path for server-resolved `bound` inputs.

Extracted the `library/[guid]` render path into a reusable `loadDefinitionForRender` helper so the bound-input solve path has a single home. The boot-time integrity check now fires on the first request instead of at module load, so test files importing the route-classification helpers no longer trip provider lookups before their fakes are wired.
