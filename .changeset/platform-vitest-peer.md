---
'@selvajs/platform': patch
---

Widen the optional `vitest` peer range to `^3.2.4 || ^4.0.0 || ^5.0.0`, so consumers on vitest 4 or 5 no longer hit an npm ERESOLVE. The contract suites in `@selvajs/platform/testing` already run on vitest 5 here.
