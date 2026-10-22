---
'@selvajs/compute': patch
---

Defect fixes:

- A definition's first solve through `createScheduler()` now reports `definitionReuploaded: true`. It uploads the full definition, but was reported as a server cache hit.
- A server error `code` that names an `Object.prototype` member (`"constructor"`) no longer resolves to a prototype function. It is ignored like any undeclared code.
- `config.headers` can no longer double a transport header by using different casing. A caller `rhinocomputekey`, `authorization`, `content-type` or `x-request-id` is dropped instead of being sent next to the real one.
- `fetchDefinitionIO` errors no longer carry the whole definition in `context`.
- An input default that is already a branch-path map (`{ '{0}': [1, 2] }`) is kept, not dropped as malformed.
- Numeric step sizes come from one decimal count that ignores float noise and handles exponent notation: `3.3000000000000003` gives step `0.1` (was `1e-12`), `1.5e21` gives `1` (was `0.00001`).
- `fetchDefinitionIO` warns when it runs in a browser, as `fetchParsedDefinitionIO` already did. A 504 is labelled "Gateway timeout".
- README, the example and JSDoc examples fixed: `cache` takes `maxBytes`, a definition is a URL or bytes rather than a file name, cancellations are matched by `err.code`, the liveness probe is `GET /`, and the default port is 6500.
