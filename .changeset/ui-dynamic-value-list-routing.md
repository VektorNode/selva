---
'@selvajs/ui': minor
---

Support dynamic value lists in the preview runtime, plus a client-side file-size guard.

- `buildDynamicValueListOptions` now takes the whole `UISchema` (was just `outputs`) and collects every `dynamicValueList` source from both `schema.outputs[]` and the layout. The layout pass is back-compat defense for schemas persisted by an older plugin that did not mirror dynamic outputs into `outputs[]`; for current schemas it finds nothing new. `TabLayout` is updated to pass the schema.
- `FileInput` now rejects oversize uploads client-side (against `APP_DEFAULTS.FILE_UPLOAD.MAX_SIZE_BYTES`) instead of letting the request fail server-side with an opaque 413, matching the existing URL-import check.
