---
'@selvajs/compute': patch
'@selvajs/solve': patch
---

A redeployed plugin no longer leaves old results in the solve cache. `getLimits()` now reads `deploymentId`, which the VektorNode fork reports and changes on every restart or child recycle. A warm client whose cache could answer re-reads it once it is 30 s old, waiting at most 1 s, and a client that reports another deployment is rebuilt with an empty cache. Before, the cache treated a solve as a pure function of the definition and its inputs, so after a plugin redeploy it served the old plugin's output for any inputs it had already seen, until the app restarted.
