---
'@selvajs/platform': patch
'@selvajs/local-provider': patch
---

Document that `GuidSchema` is the prototype-pollution guard for the definition stores.

The stores index plain objects by guid (`config.definitions[guid]`), so the UUID regex is
load-bearing beyond format validation: it is what keeps `__proto__` and `constructor` out of
a key position. `LocalDefinitionStore.live()` does not stop a prototype lookup on its own —
`definitions['__proto__']` returns `Object.prototype`, whose `deletedAt` is undefined, so it
passes as a live record and the caller's `Object.assign` writes onto the prototype.

Comments only; no behavior change. Both are noted at the point a future entry point would
have to preserve the invariant.
