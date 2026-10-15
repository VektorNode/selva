---
'@selvajs/compute': patch
---

The liveness probe no longer follows a redirect from `/`: a Compute build that redirects its root (to rhino3d.com) reads as online at once, instead of timing out on the public internet and sending the `RhinoComputeKey` header along.
